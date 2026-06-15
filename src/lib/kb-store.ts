/**
 * kb-store.ts — CRUD service for kb_entries (used by the admin API).
 *
 * Rules enforced here:
 *   * Every create/update sets embedding = NULL so the embed worker re-embeds.
 *   * All queries are parameterized.
 */

import { Pool } from "pg";

export type EntryType = "faq" | "guide";
export type EntryStatus = "draft" | "published" | "archived";

export type KbEntry = {
    id: string;
    entry_type: EntryType;
    category: string | null;
    question: string;
    aliases: string[];
    answer: string;
    status: EntryStatus;
    embedding_pending: boolean; // true when embedding IS NULL
    source_ref: string | null;
    created_at: string;
    updated_at: string;
};

export type EntryInput = {
    entry_type: EntryType;
    category: string | null;
    question: string;
    aliases: string[];
    answer: string;
    status: EntryStatus;
};

const SELECT_COLS = `
    id, entry_type, category, question, aliases, answer, status,
    (embedding IS NULL) AS embedding_pending, source_ref,
    created_at::text, updated_at::text
`;

const ENTRY_TYPES: EntryType[] = ["faq", "guide"];
const STATUSES: EntryStatus[] = ["draft", "published", "archived"];

/** Validates and normalizes raw input from the admin API. Throws on bad input. */
export function normalizeEntryInput(raw: unknown): EntryInput {
    if (!raw || typeof raw !== "object") {
        throw new Error("Тіло запиту має бути об'єктом.");
    }
    const r = raw as Record<string, unknown>;

    const question = typeof r.question === "string" ? r.question.trim() : "";
    const answer = typeof r.answer === "string" ? r.answer.trim() : "";
    if (!question) throw new Error("Поле 'question' обов'язкове.");
    if (!answer) throw new Error("Поле 'answer' обов'язкове.");

    const entry_type = ENTRY_TYPES.includes(r.entry_type as EntryType)
        ? (r.entry_type as EntryType)
        : "faq";
    const status = STATUSES.includes(r.status as EntryStatus)
        ? (r.status as EntryStatus)
        : "draft";

    const category =
        typeof r.category === "string" && r.category.trim() ? r.category.trim() : null;

    let aliases: string[] = [];
    if (Array.isArray(r.aliases)) {
        aliases = r.aliases
            .filter((a): a is string => typeof a === "string")
            .map((a) => a.trim())
            .filter(Boolean);
    } else if (typeof r.aliases === "string") {
        // Allow newline/comma-separated string from the form.
        aliases = r.aliases
            .split(/[\n,]/)
            .map((a) => a.trim())
            .filter(Boolean);
    }

    return { entry_type, category, question, aliases, answer, status };
}

export async function listEntries(
    pool: Pool,
    filters: { category?: string | null; status?: string | null; q?: string | null },
): Promise<KbEntry[]> {
    const result = await pool.query<KbEntry>(
        `
        SELECT ${SELECT_COLS}
        FROM kb_entries
        WHERE ($1::text IS NULL OR category = $1)
          AND ($2::text IS NULL OR status = $2)
          AND ($3::text IS NULL OR question ILIKE '%' || $3 || '%' OR answer ILIKE '%' || $3 || '%')
        ORDER BY updated_at DESC
        LIMIT 500
        `,
        [filters.category ?? null, filters.status ?? null, filters.q ?? null],
    );
    return result.rows;
}

export async function getEntry(pool: Pool, id: string): Promise<KbEntry | null> {
    const result = await pool.query<KbEntry>(
        `SELECT ${SELECT_COLS} FROM kb_entries WHERE id = $1`,
        [id],
    );
    return result.rows[0] ?? null;
}

export async function createEntry(pool: Pool, input: EntryInput): Promise<KbEntry> {
    const result = await pool.query<KbEntry>(
        `
        INSERT INTO kb_entries
            (entry_type, category, question, aliases, answer, status, embedding)
        VALUES ($1, $2, $3, $4::text[], $5, $6, NULL)
        RETURNING ${SELECT_COLS}
        `,
        [input.entry_type, input.category, input.question, input.aliases, input.answer, input.status],
    );
    return result.rows[0];
}

export async function updateEntry(
    pool: Pool,
    id: string,
    input: EntryInput,
): Promise<KbEntry | null> {
    // embedding = NULL forces re-embedding; updated_at bumped for edit tracking.
    const result = await pool.query<KbEntry>(
        `
        UPDATE kb_entries
        SET entry_type = $2, category = $3, question = $4, aliases = $5::text[],
            answer = $6, status = $7, embedding = NULL, updated_at = NOW()
        WHERE id = $1
        RETURNING ${SELECT_COLS}
        `,
        [id, input.entry_type, input.category, input.question, input.aliases, input.answer, input.status],
    );
    return result.rows[0] ?? null;
}

export async function archiveEntry(pool: Pool, id: string): Promise<KbEntry | null> {
    const result = await pool.query<KbEntry>(
        `UPDATE kb_entries SET status = 'archived', updated_at = NOW()
         WHERE id = $1 RETURNING ${SELECT_COLS}`,
        [id],
    );
    return result.rows[0] ?? null;
}

export async function deleteEntry(pool: Pool, id: string): Promise<boolean> {
    const result = await pool.query(`DELETE FROM kb_entries WHERE id = $1`, [id]);
    return (result.rowCount ?? 0) > 0;
}
