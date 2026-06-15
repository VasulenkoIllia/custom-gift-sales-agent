-- 011_abuse_guard.sql — anti-spam counters, strikes, token accounting, response cache.
-- All state keys on customers.id so it survives process restarts. Single-process app,
-- so atomic upserts (no advisory locks) are sufficient.

-- ── Rate counters: one row per (customer, window_kind, window_start bucket) ─────
-- window_kind: 'burst10s' | 'min' | 'hour' | 'day'. Counting = atomic upsert.
CREATE TABLE IF NOT EXISTS rate_counters (
    customer_id   UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    window_kind   TEXT        NOT NULL,
    window_start  TIMESTAMPTZ NOT NULL,
    count         INTEGER     NOT NULL DEFAULT 0,
    PRIMARY KEY (customer_id, window_kind, window_start)
);
CREATE INDEX IF NOT EXISTS rate_counters_window_start_idx
    ON rate_counters (window_start);

-- ── Strikes / escalating cooldown + behavioral memory: one row per customer ────
CREATE TABLE IF NOT EXISTS user_abuse_state (
    customer_id     UUID PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
    strikes         INTEGER     NOT NULL DEFAULT 0,
    muted_until     TIMESTAMPTZ,
    last_strike_at  TIMESTAMPTZ,
    last_text_hash  TEXT,
    repeat_count    INTEGER     NOT NULL DEFAULT 0,
    notice_sent_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS user_abuse_state_muted_until_idx
    ON user_abuse_state (muted_until) WHERE muted_until IS NOT NULL;

-- ── Token / cost accounting: one row per OpenAI call ──────────────────────────
CREATE TABLE IF NOT EXISTS token_usage (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id       UUID          REFERENCES customers(id) ON DELETE SET NULL,
    conversation_id   UUID,
    kind              TEXT          NOT NULL,         -- 'chat' | 'embedding' | 'moderation'
    model             TEXT          NOT NULL,
    prompt_tokens     INTEGER       NOT NULL DEFAULT 0,
    completion_tokens INTEGER       NOT NULL DEFAULT 0,
    total_tokens      INTEGER       NOT NULL DEFAULT 0,
    cost_usd          NUMERIC(12,6) NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS token_usage_created_at_idx ON token_usage (created_at);
CREATE INDEX IF NOT EXISTS token_usage_customer_day_idx ON token_usage (customer_id, created_at);

-- ── Response cache: normalized-query hash → cached answer ──────────────────────
CREATE TABLE IF NOT EXISTS response_cache (
    query_hash    TEXT        PRIMARY KEY,
    answer        TEXT        NOT NULL,
    used_matches  INTEGER     NOT NULL DEFAULT 0,
    kb_version    BIGINT      NOT NULL,
    hits          INTEGER     NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS response_cache_expires_at_idx ON response_cache (expires_at);
