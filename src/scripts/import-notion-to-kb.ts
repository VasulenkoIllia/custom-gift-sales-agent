/**
 * import-notion-to-kb.ts — ONE-TIME import of the existing Notion KB into kb_entries.
 *
 * After a verified run, Notion is retired as the CMS (the web admin panel becomes
 * the source of truth). This script is idempotent on re-runs: it upserts by
 * source_ref = 'notion:<page_id>'.
 *
 *   NOTION_API_KEY=... npm run kb:import-notion
 *
 * Mapping  Notion → kb_entries:
 *   Назва               → question
 *   Тип (FAQ)           → entry_type 'faq'; everything else → 'guide'
 *   Категорія           → category
 *   Відповідь / Контент → answer (legacy "Питання: X<br>Відповідь: Y" prefix stripped)
 *   Статус              → status (Published→published, Draft→draft, Archived→archived)
 */

import { createDbPoolFromEnv } from "../lib/db.js";

const NOTION_API_KEY = process.env.NOTION_API_KEY;
if (!NOTION_API_KEY) {
    console.error("ERROR: NOTION_API_KEY is not set. Add it to your environment for this one-time run.");
    process.exit(1);
}

const RAW_DB_ID = process.env.NOTION_KB_DATABASE_ID ?? "e39ad4ecba94480887a7584aa7017057";

function toHyphenatedUuid(id: string): string {
    const s = id.replace(/-/g, "");
    if (s.length !== 32) return id;
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

const NOTION_DB_ID = toHyphenatedUuid(RAW_DB_ID);
const NOTION_API_VERSION = "2022-06-28";
const NOTION_BASE = "https://api.notion.com/v1";

type RichTextItem = { plain_text: string };
type NotionPage = {
    id: string;
    properties: {
        "Назва": { title: RichTextItem[] };
        "Тип": { select: { name: string } | null };
        "Категорія": { select: { name: string } | null };
        "Відповідь / Контент": { rich_text: RichTextItem[] };
        "Статус": { select: { name: string } | null };
    };
};
type QueryResponse = { results: NotionPage[]; has_more: boolean; next_cursor: string | null };

async function notionReq<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${NOTION_BASE}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${NOTION_API_KEY}`,
            "Content-Type": "application/json",
            "Notion-Version": NOTION_API_VERSION,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Notion ${method} ${path} → ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
}

async function fetchAllPages(): Promise<NotionPage[]> {
    const pages: NotionPage[] = [];
    let cursor: string | undefined;
    for (;;) {
        const body: Record<string, unknown> = { page_size: 100 };
        if (cursor) body.start_cursor = cursor;
        const r = await notionReq<QueryResponse>("POST", `/databases/${NOTION_DB_ID}/query`, body);
        pages.push(...r.results);
        if (!r.has_more || !r.next_cursor) break;
        cursor = r.next_cursor;
    }
    return pages;
}

function plain(items: RichTextItem[]): string {
    return items.map((t) => t.plain_text).join("").trim();
}

/** Strip the legacy "Питання: X<br>Відповідь: " prefix; Notion stores \n as <br>. */
function extractAnswerText(content: string): string {
    const m = content.match(/^Питання:[\s\S]*?(?:<br>|\n)Відповідь:\s*/);
    if (m) return content.slice(m[0].length).trim();
    if (/^Відповідь:\s*/.test(content)) return content.replace(/^Відповідь:\s*/, "").trim();
    return content.trim();
}

function mapStatus(notionStatus: string): string {
    switch (notionStatus) {
        case "Published": return "published";
        case "Archived":  return "archived";
        default:          return "draft";
    }
}

async function main(): Promise<void> {
    const pool = createDbPoolFromEnv();

    console.log(`\n=== Import Notion → kb_entries ===`);
    console.log(`Database: ${NOTION_DB_ID}\n`);

    const pages = await fetchAllPages();
    console.log(`Fetched ${pages.length} Notion pages.\n`);

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const page of pages) {
        const p = page.properties;
        const question = plain(p["Назва"].title);
        const rawContent = plain(p["Відповідь / Контент"].rich_text);
        const answer = extractAnswerText(rawContent);

        if (!question || !answer) {
            skipped++;
            console.warn(`  SKIP (empty question/answer): "${question.slice(0, 50)}"`);
            continue;
        }

        const type = p["Тип"]?.select?.name ?? "FAQ";
        const entryType = type === "FAQ" ? "faq" : "guide";
        const category = p["Категорія"]?.select?.name ?? null;
        const status = mapStatus(p["Статус"]?.select?.name ?? "Draft");
        const sourceRef = `notion:${page.id}`;

        // Upsert by source_ref so re-runs are idempotent.
        const existing = await pool.query<{ id: string }>(
            `SELECT id FROM kb_entries WHERE source_ref = $1 LIMIT 1`,
            [sourceRef],
        );

        if (existing.rows.length > 0) {
            await pool.query(
                `UPDATE kb_entries
                 SET entry_type = $1, category = $2, question = $3, answer = $4,
                     status = $5, embedding = NULL, updated_at = NOW()
                 WHERE id = $6`,
                [entryType, category, question, answer, status, existing.rows[0].id],
            );
            updated++;
            process.stdout.write(`  ~ UPDATE [${entryType}/${category}] ${question.slice(0, 55)}\n`);
        } else {
            await pool.query(
                `INSERT INTO kb_entries
                   (entry_type, category, question, aliases, answer, status, source_ref, embedding)
                 VALUES ($1, $2, $3, '{}', $4, $5, $6, NULL)`,
                [entryType, category, question, answer, status, sourceRef],
            );
            inserted++;
            process.stdout.write(`  + INSERT [${entryType}/${category}] ${question.slice(0, 55)}\n`);
        }
    }

    await pool.end();

    console.log(`\nDone: inserted=${inserted}, updated=${updated}, skipped=${skipped}`);
    console.log(`Next: run "npm run embeddings:kb" to generate embeddings.`);
}

main().catch((err) => {
    console.error("\nImport failed:", err instanceof Error ? err.message : err);
    process.exit(1);
});
