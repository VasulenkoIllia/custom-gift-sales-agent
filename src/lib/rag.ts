/**
 * rag.ts — Unified retrieval layer for the support knowledge base.
 *
 * search() runs a hybrid search over the `kb_entries` table and merges three
 * ranked lists with Reciprocal Rank Fusion (RRF):
 *   1. vector    — cosine similarity over the question+aliases embedding
 *   2. fulltext  — to_tsvector('simple') over question+aliases
 *   3. trigram   — pg_trgm word_similarity over question+aliases (Ukrainian morphology)
 *
 * Critical design rule (fixes "AI confuses questions and answers"):
 *   The embedding, tsv and search_key are all derived from question+aliases ONLY.
 *   The `answer` column is NEVER a search signal — it is only returned as the
 *   payload the LLM answers from. A long answer can therefore never dilute the
 *   question's semantic signal.
 */

import { Pool } from "pg";
import { OpenAiClient, UsageInfo } from "./openai-client.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type KbMatch = {
    id: string;
    entry_type: "faq" | "guide";
    category: string | null;
    question: string;   // matched intent (shown in admin TEST SEARCH; orients the LLM)
    answer: string;     // the payload the LLM actually answers from
    score: number;      // RRF score after optional category boost (higher = better)
};

export type SearchOptions = {
    limit?: number;
    /** Detected category for SOFT boosting (never a hard filter). */
    category?: string | null;
    /** Vector cosine-distance threshold override. Lower = stricter. */
    vectorThreshold?: number;
    /** Same-category score multiplier override (soft boost). */
    categoryBoost?: number;
    /** Optional callback to capture embedding token usage (for cost accounting). */
    onUsage?: (usage: UsageInfo) => void;
};

// ─── Tunables ──────────────────────────────────────────────────────────────────

const VECTOR_THRESHOLD = Number(process.env.KB_VECTOR_THRESHOLD ?? 0.45);
const TRIGRAM_FLOOR    = Number(process.env.KB_TRIGRAM_FLOOR ?? 0.3);
// Same-category matches get their fused score multiplied by this factor.
// A boost (not a filter) so a mis-detected category never drops the right answer.
const CATEGORY_BOOST   = Number(process.env.KB_CATEGORY_BOOST ?? 1.25);
// RRF constant. Small corpus (~60 entries) → small k so rank-1 clearly outweighs rank-10.
const RRF_K = 20;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function asVectorLiteral(embedding: number[]): string {
    return `[${embedding.join(",")}]`;
}

type RankedRow = { id: string; rrf_rank: number; row: KbRow };

type KbRow = {
    id: string;
    entry_type: "faq" | "guide";
    category: string | null;
    question: string;
    answer: string;
};

const KB_SELECT = `c.id, c.entry_type, c.category, c.question, c.answer`;

/**
 * Reciprocal Rank Fusion over N ranked lists.
 * score(d) = Σ 1/(k + rank_i)
 */
function mergeRRF(lists: RankedRow[][], limit: number): Map<string, number> {
    const scores = new Map<string, number>();
    for (const list of lists) {
        for (const row of list) {
            const prev = scores.get(row.id) ?? 0;
            scores.set(row.id, prev + 1 / (RRF_K + row.rrf_rank));
        }
    }
    return new Map(
        [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit),
    );
}

// ─── Vector search ────────────────────────────────────────────────────────────

async function vectorSearch(
    pool: Pool,
    embedding: number[],
    opts: SearchOptions,
): Promise<RankedRow[]> {
    const vec = asVectorLiteral(embedding);
    const limit = (opts.limit ?? 6) * 3; // fetch more; RRF trims
    const threshold = opts.vectorThreshold ?? VECTOR_THRESHOLD;

    const result = await pool.query(
        `
        SELECT ${KB_SELECT},
               ROW_NUMBER() OVER (ORDER BY c.embedding <=> $1::vector) AS rrf_rank
        FROM kb_entries c
        WHERE c.status = 'published'
          AND c.embedding IS NOT NULL
          AND (c.embedding <=> $1::vector) < $2
        ORDER BY c.embedding <=> $1::vector
        LIMIT $3
        `,
        [vec, threshold, limit],
    );

    return result.rows.map((r, i) => ({ id: r.id, rrf_rank: i + 1, row: r as KbRow }));
}

// ─── Full-text search ─────────────────────────────────────────────────────────

async function fulltextSearch(
    pool: Pool,
    query: string,
    opts: SearchOptions,
): Promise<RankedRow[]> {
    const limit = (opts.limit ?? 6) * 3;

    // OR semantics: tokenise the query and join lexemes with " | " so any token
    // can match. Falls back to the raw query when tokenisation yields nothing.
    const result = await pool.query(
        `
        WITH q AS (
            SELECT COALESCE(
                NULLIF(
                    array_to_string(
                        ARRAY(SELECT lexeme FROM unnest(to_tsvector('simple', $1))),
                        ' | '
                    ),
                    ''
                ),
                $1
            ) AS tsq_text
        )
        SELECT ${KB_SELECT},
               ROW_NUMBER() OVER (
                   ORDER BY ts_rank_cd(c.tsv, to_tsquery('simple', q.tsq_text)) DESC
               ) AS rrf_rank
        FROM kb_entries c
        CROSS JOIN q
        WHERE c.status = 'published'
          AND c.tsv @@ to_tsquery('simple', q.tsq_text)
        ORDER BY ts_rank_cd(c.tsv, to_tsquery('simple', q.tsq_text)) DESC
        LIMIT $2
        `,
        [query, limit],
    );

    return result.rows.map((r, i) => ({ id: r.id, rrf_rank: i + 1, row: r as KbRow }));
}

// ─── Trigram search (Ukrainian morphology / typos) ─────────────────────────────

async function trigramSearch(
    pool: Pool,
    query: string,
    opts: SearchOptions,
): Promise<RankedRow[]> {
    const limit = (opts.limit ?? 6) * 3;

    const result = await pool.query(
        `
        SELECT ${KB_SELECT},
               ROW_NUMBER() OVER (
                   ORDER BY word_similarity($1, c.search_key) DESC
               ) AS rrf_rank
        FROM kb_entries c
        WHERE c.status = 'published'
          AND word_similarity($1, c.search_key) > $2
        ORDER BY word_similarity($1, c.search_key) DESC
        LIMIT $3
        `,
        [query, TRIGRAM_FLOOR, limit],
    );

    return result.rows.map((r, i) => ({ id: r.id, rrf_rank: i + 1, row: r as KbRow }));
}

// ─── Main search ──────────────────────────────────────────────────────────────

/**
 * Hybrid search over published kb_entries: vector + full-text + trigram, merged
 * with RRF, then a soft same-category boost. Degrades gracefully when any single
 * arm fails or returns nothing (e.g. no OpenAI client → lexical-only).
 */
export async function search(
    pool: Pool,
    openAiClient: OpenAiClient | null,
    query: string,
    opts: SearchOptions = {},
): Promise<KbMatch[]> {
    const limit = opts.limit ?? 6;

    const empty: RankedRow[] = [];
    const [vectorRows, textRows, trgmRows] = await Promise.all([
        openAiClient
            ? openAiClient
                  .createEmbeddingWithUsage(query)
                  .then(({ embedding, usage }) => {
                      opts.onUsage?.(usage);
                      return vectorSearch(pool, embedding, opts);
                  })
                  .catch((err) => {
                      console.error("[rag] vector search failed:", err instanceof Error ? err.message : err);
                      return empty;
                  })
            : Promise.resolve(empty),
        fulltextSearch(pool, query, opts).catch((err) => {
            console.error("[rag] fulltext search failed:", err instanceof Error ? err.message : err);
            return empty;
        }),
        trigramSearch(pool, query, opts).catch((err) => {
            console.error("[rag] trigram search failed:", err instanceof Error ? err.message : err);
            return empty;
        }),
    ]);

    const rowById = new Map<string, KbRow>();
    for (const r of [...vectorRows, ...textRows, ...trgmRows]) {
        if (!rowById.has(r.id)) rowById.set(r.id, r.row);
    }
    if (rowById.size === 0) return [];

    // Fuse, then apply the soft category boost and re-rank.
    const fused = mergeRRF([vectorRows, textRows, trgmRows], rowById.size);
    const detected = opts.category ?? null;
    const boost = opts.categoryBoost ?? CATEGORY_BOOST;

    const boosted = [...fused.entries()].map(([id, score]) => {
        const row = rowById.get(id)!;
        const finalScore =
            detected && row.category === detected ? score * boost : score;
        return { row, score: finalScore };
    });

    boosted.sort((a, b) => b.score - a.score);

    return boosted.slice(0, limit).map(({ row, score }) => ({
        id: row.id,
        entry_type: row.entry_type,
        category: row.category,
        question: row.question,
        answer: row.answer,
        score,
    }));
}

// ─── Format for prompt ───────────────────────────────────────────────────────

/**
 * Formats matches into a KNOWLEDGE_BASE block. Question and answer are labelled
 * explicitly so the LLM cannot conflate them.
 */
export function formatContext(matches: KbMatch[]): string {
    if (matches.length === 0) return "KNOWLEDGE_BASE: no results";

    return matches
        .map((m, i) => {
            const cat = m.category ? ` (категорія: ${m.category})` : "";
            return `[${i + 1}]${cat}\nПитання: ${m.question}\nВідповідь: ${m.answer}`;
        })
        .join("\n\n");
}

// ─── Embedding pipeline ───────────────────────────────────────────────────────

export type EmbeddableEntry = { id: string; search_key: string };

/**
 * Returns published entries whose embedding is stale (NULL), oldest-edited first.
 * Embeds the SEARCH KEY (question + aliases), never the answer.
 */
export async function getEmbeddableKbEntries(
    pool: Pool,
    limit: number,
    excludeIds: string[] = [],
): Promise<EmbeddableEntry[]> {
    const result = await pool.query<EmbeddableEntry>(
        `
        SELECT id, search_key
        FROM kb_entries
        WHERE embedding IS NULL
          AND status = 'published'
          AND (cardinality($2::uuid[]) = 0 OR id != ALL($2::uuid[]))
        ORDER BY updated_at ASC
        LIMIT $1
        `,
        [limit, excludeIds],
    );
    return result.rows;
}

export async function upsertKbEmbedding(
    pool: Pool,
    entryId: string,
    embedding: number[],
): Promise<void> {
    // Do NOT bump updated_at here — that column tracks content edits, not embeds.
    await pool.query(
        `UPDATE kb_entries SET embedding = $1::vector WHERE id = $2`,
        [asVectorLiteral(embedding), entryId],
    );
}
