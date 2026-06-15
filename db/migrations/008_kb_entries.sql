-- 008_kb_entries.sql
-- Authored support knowledge base. Single source of truth AND retrieval target.
--
-- Design notes:
--   * Embedding is built from the SEARCH KEY (question + aliases) ONLY.
--     The answer/body is returned to the LLM as payload, NEVER embedded and
--     NEVER part of the full-text / trigram index. This is the root fix for
--     "the AI confuses questions and answers": a long answer can no longer
--     dilute the question's semantic signal.
--   * Retrieval queries this table DIRECTLY — there is no separate chunks index
--     and no internal sync step. Editing an entry sets embedding = NULL, and the
--     embeddings worker re-embeds it.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Immutable helper: builds the search key from question + aliases.
-- array_to_string is marked STABLE by PG (conservative — its output function for
-- non-text element types could depend on GUCs), but for text[] it is genuinely
-- deterministic, so wrapping it as IMMUTABLE here is safe and lets us use it in
-- STORED generated columns.
CREATE OR REPLACE FUNCTION kb_search_key(q TEXT, a TEXT[])
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$ SELECT q || ' ' || array_to_string(a, ' ') $$;

CREATE TABLE IF NOT EXISTS kb_entries (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_type  TEXT NOT NULL DEFAULT 'faq'
                CHECK (entry_type IN ('faq', 'guide')),
    category    TEXT,                          -- connectivity|power|sensor|colors|physical|safety|app_account|meta
    question    TEXT NOT NULL,                 -- title for guides; the primary search key
    aliases     TEXT[] NOT NULL DEFAULT '{}',  -- paraphrases / morphological variants, also part of the search key
    answer      TEXT NOT NULL,                 -- payload returned to the LLM; NEVER embedded
    status      TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'published', 'archived')),
    embedding   VECTOR(1536),                  -- NULL = stale, picked up by the embed worker
    -- Search-key text used for BOTH embedding input AND full-text/trigram.
    -- Generated so it can never drift from question/aliases.
    search_key  TEXT GENERATED ALWAYS AS (kb_search_key(question, aliases)) STORED,
    tsv         TSVECTOR GENERATED ALWAYS AS (
                    to_tsvector('simple', kb_search_key(question, aliases))
                ) STORED,
    source_ref  TEXT,                          -- e.g. 'notion:<page_id>' for the one-time import; audit only
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Vector index (HNSW, cosine).
CREATE INDEX IF NOT EXISTS kb_entries_embedding_idx
    ON kb_entries USING hnsw (embedding vector_cosine_ops);

-- Full-text over the search key (question + aliases only).
CREATE INDEX IF NOT EXISTS kb_entries_tsv_idx
    ON kb_entries USING gin (tsv);

-- Trigram over the search key for Ukrainian morphology (нагрівається ~ нагрів).
CREATE INDEX IF NOT EXISTS kb_entries_search_key_trgm_idx
    ON kb_entries USING gin (search_key gin_trgm_ops);

-- Cheap category/status filtering for the admin list and soft-boost lookups.
CREATE INDEX IF NOT EXISTS kb_entries_category_status_idx
    ON kb_entries (category, status);
