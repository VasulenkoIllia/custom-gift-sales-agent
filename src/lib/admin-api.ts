/**
 * admin-api.ts — KB admin panel: static page + JSON REST, all Basic-auth gated.
 *
 * Mounted at /admin* from index.ts. Keeps index.ts thin.
 *
 * Auth: HTTP Basic against ADMIN_USER / ADMIN_PASSWORD env vars. If those are not
 * set, the panel is disabled (503) — it never runs open. Comparison is
 * constant-time (hash-then-timingSafeEqual) to avoid leaking credential length.
 *
 * Security surface: this is an authenticated, write-capable API. Run the
 * security-review skill before exposing it publicly; sit it behind TLS + ideally
 * an IP allowlist / VPN.
 */

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, timingSafeEqual } from "node:crypto";
import { Pool } from "pg";
import { OpenAiClient } from "./openai-client.js";
import { search, getEmbeddableKbEntries, upsertKbEmbedding } from "./rag.js";
import { invalidateKbCache } from "./abuse-guard.js";
import { detectCategory, SUPPORT_CATEGORY_KEYWORDS } from "../config/support-categories.js";
import { AiConsultantService } from "./ai-consultant.js";
import { loadAgentConfig, updateAgentConfig, getRetrievalTunables } from "./agent-config.js";
import {
    archiveEntry,
    createEntry,
    deleteEntry,
    getEntry,
    listEntries,
    normalizeEntryInput,
    updateEntry,
} from "./kb-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_HTML_PATH = path.resolve(__dirname, "../admin/index.html");

export type AdminDeps = {
    pool: Pool;
    openAiClient: OpenAiClient | null;
    consultant: AiConsultantService;
};

// ─── HTTP helpers ──────────────────────────────────────────────────────────────

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload));
}

async function readJsonBody<T>(req: http.IncomingMessage): Promise<T> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    return (text ? JSON.parse(text) : {}) as T;
}

// ─── Auth ────────────────────────────────────────────────────────────────────

function safeEqual(a: string, b: string): boolean {
    // Hash to equalize length, then constant-time compare.
    const ha = createHash("sha256").update(a).digest();
    const hb = createHash("sha256").update(b).digest();
    return timingSafeEqual(ha, hb);
}

/** Returns true if authorized. Writes 401/503 and returns false otherwise. */
function checkAuth(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    const expectedUser = process.env.ADMIN_USER;
    const expectedPass = process.env.ADMIN_PASSWORD;

    if (!expectedUser || !expectedPass) {
        sendJson(res, 503, {
            error: "Адмін-панель не налаштована. Задайте ADMIN_USER та ADMIN_PASSWORD у середовищі.",
        });
        return false;
    }

    const header = req.headers["authorization"] ?? "";
    if (!header.startsWith("Basic ")) {
        res.writeHead(401, {
            "WWW-Authenticate": 'Basic realm="INTELLECT KB", charset="UTF-8"',
            "Content-Type": "application/json; charset=utf-8",
        });
        res.end(JSON.stringify({ error: "Потрібна авторизація." }));
        return false;
    }

    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const sep = decoded.indexOf(":");
    const user = sep >= 0 ? decoded.slice(0, sep) : decoded;
    const pass = sep >= 0 ? decoded.slice(sep + 1) : "";

    // Evaluate both comparisons regardless to avoid short-circuit timing leaks.
    const userOk = safeEqual(user, expectedUser);
    const passOk = safeEqual(pass, expectedPass);
    if (userOk && passOk) return true;

    res.writeHead(401, {
        "WWW-Authenticate": 'Basic realm="INTELLECT KB", charset="UTF-8"',
        "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify({ error: "Невірні облікові дані." }));
    return false;
}

// ─── Routing ───────────────────────────────────────────────────────────────────

export async function handleAdminRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    deps: AdminDeps,
): Promise<void> {
    if (!checkAuth(req, res)) return;

    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname;
    const method = req.method ?? "GET";

    try {
        // Static panel
        if (method === "GET" && (pathname === "/admin" || pathname === "/admin/")) {
            const html = await fs.readFile(ADMIN_HTML_PATH, "utf8");
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(html);
            return;
        }

        // Meta (categories / enums for the form)
        if (method === "GET" && pathname === "/admin/api/meta") {
            sendJson(res, 200, {
                categories: Object.keys(SUPPORT_CATEGORY_KEYWORDS),
                entry_types: ["faq", "guide"],
                statuses: ["draft", "published", "archived"],
            });
            return;
        }

        // Agent settings — read
        if (method === "GET" && pathname === "/admin/api/agent") {
            const cfg = await loadAgentConfig(deps.pool);
            const t = getRetrievalTunables(cfg);
            sendJson(res, 200, {
                agent: {
                    persona: cfg?.persona ?? "",
                    instructions: cfg?.instructions ?? "",
                    fallback_message: cfg?.fallback_message ?? "",
                    model: cfg?.model ?? "",
                    language: cfg?.language ?? "",
                    top_k: t.topK,
                    vector_threshold: t.vectorThreshold,
                    category_boost: t.categoryBoost,
                },
            });
            return;
        }

        // Agent settings — update (then hot-reload the live consultant)
        if (method === "PUT" && pathname === "/admin/api/agent") {
            const b = await readJsonBody<Record<string, unknown>>(req);
            const str = (v: unknown) => (typeof v === "string" ? v : undefined);
            const pos = (v: unknown) => {
                const n = Number(v);
                return Number.isFinite(n) && n > 0 ? n : undefined;
            };
            const extra: Record<string, unknown> = {};
            if (pos(b.top_k) !== undefined) extra.top_k = pos(b.top_k);
            if (pos(b.vector_threshold) !== undefined) extra.vector_threshold = pos(b.vector_threshold);
            if (pos(b.category_boost) !== undefined) extra.category_boost = pos(b.category_boost);

            await updateAgentConfig(deps.pool, {
                persona: str(b.persona),
                instructions: str(b.instructions),
                fallback_message: str(b.fallback_message),
                model: str(b.model),
                language: str(b.language),
                extra_config: Object.keys(extra).length ? extra : undefined,
            });
            await deps.consultant.reloadAgentConfig();
            const cfg = await loadAgentConfig(deps.pool);
            const t = getRetrievalTunables(cfg);
            sendJson(res, 200, {
                ok: true,
                agent: {
                    persona: cfg?.persona ?? "", instructions: cfg?.instructions ?? "",
                    fallback_message: cfg?.fallback_message ?? "", model: cfg?.model ?? "",
                    language: cfg?.language ?? "", top_k: t.topK,
                    vector_threshold: t.vectorThreshold, category_boost: t.categoryBoost,
                },
            });
            return;
        }

        // Test answer — full bot reply with current prompt + settings (no persistence)
        if (method === "POST" && pathname === "/admin/api/test-answer") {
            const body = await readJsonBody<{ query?: string }>(req);
            const query = (body.query ?? "").trim();
            if (!query) { sendJson(res, 400, { error: "Поле 'query' обов'язкове." }); return; }
            const result = await deps.consultant.previewReply(query);
            sendJson(res, 200, {
                text: result.text,
                source: result.source,
                usedMatches: result.usedMatches,
                detectedCategory: result.detectedCategory,
                matches: result.matches,
            });
            return;
        }

        // Embed all pending (published, embedding IS NULL) entries — one-click
        // re-index so editors never touch the terminal.
        if (method === "POST" && pathname === "/admin/api/embed-pending") {
            if (!deps.openAiClient) {
                sendJson(res, 503, { error: "OPENAI_API_KEY не налаштовано — ембединги недоступні." });
                return;
            }
            const pending = await getEmbeddableKbEntries(deps.pool, 500);
            let embedded = 0;
            const failures: string[] = [];
            for (const entry of pending) {
                try {
                    const emb = await deps.openAiClient.createEmbedding(entry.search_key);
                    await upsertKbEmbedding(deps.pool, entry.id, emb);
                    embedded += 1;
                } catch (e) {
                    failures.push(entry.id);
                }
            }
            if (embedded > 0) await invalidateKbCache(deps.pool);
            sendJson(res, 200, { embedded, failed: failures.length, requested: pending.length });
            return;
        }

        // Test search — runs the REAL retrieval the live agent uses.
        if (method === "POST" && pathname === "/admin/api/test-search") {
            const body = await readJsonBody<{ query?: string }>(req);
            const query = (body.query ?? "").trim();
            if (!query) {
                sendJson(res, 400, { error: "Поле 'query' обов'язкове." });
                return;
            }
            const detectedCategory = detectCategory(query);
            const matches = await search(deps.pool, deps.openAiClient, query, {
                limit: 6,
                category: detectedCategory,
            });
            sendJson(res, 200, { detectedCategory, matches });
            return;
        }

        // Collection
        if (pathname === "/admin/api/entries") {
            if (method === "GET") {
                const entries = await listEntries(deps.pool, {
                    category: url.searchParams.get("category"),
                    status: url.searchParams.get("status"),
                    q: url.searchParams.get("q"),
                });
                sendJson(res, 200, { entries });
                return;
            }
            if (method === "POST") {
                const input = normalizeEntryInput(await readJsonBody(req));
                const entry = await createEntry(deps.pool, input);
                await invalidateKbCache(deps.pool);
                sendJson(res, 201, { entry });
                return;
            }
        }

        // Item: /admin/api/entries/:id  and  /admin/api/entries/:id/archive
        const itemMatch = pathname.match(/^\/admin\/api\/entries\/([^/]+)(\/archive)?$/);
        if (itemMatch) {
            const id = decodeURIComponent(itemMatch[1]);
            const isArchive = Boolean(itemMatch[2]);

            if (isArchive && method === "POST") {
                const entry = await archiveEntry(deps.pool, id);
                if (!entry) { sendJson(res, 404, { error: "Не знайдено." }); return; }
                await invalidateKbCache(deps.pool);
                sendJson(res, 200, { entry });
                return;
            }
            if (!isArchive && method === "GET") {
                const entry = await getEntry(deps.pool, id);
                if (!entry) { sendJson(res, 404, { error: "Не знайдено." }); return; }
                sendJson(res, 200, { entry });
                return;
            }
            if (!isArchive && method === "PUT") {
                const input = normalizeEntryInput(await readJsonBody(req));
                const entry = await updateEntry(deps.pool, id, input);
                if (!entry) { sendJson(res, 404, { error: "Не знайдено." }); return; }
                await invalidateKbCache(deps.pool);
                sendJson(res, 200, { entry });
                return;
            }
            if (!isArchive && method === "DELETE") {
                const ok = await deleteEntry(deps.pool, id);
                if (ok) await invalidateKbCache(deps.pool);
                sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: "Не знайдено." });
                return;
            }
        }

        sendJson(res, 404, { error: "Unknown admin route", path: pathname, method });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        // Validation errors from normalizeEntryInput → 400; everything else → 500.
        const isValidation = message.includes("обов'язкове") || message.includes("об'єктом");
        sendJson(res, isValidation ? 400 : 500, { error: message });
    }
}
