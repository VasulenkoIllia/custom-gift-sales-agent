/**
 * abuse-guard.ts — Layered anti-spam / abuse detection + cost protection.
 *
 * All multi-message state lives in Postgres (rate_counters, user_abuse_state,
 * token_usage, response_cache) so it survives restarts. checkInbound() runs the
 * DB-backed layers (mute → rate windows → behavioral → budget); cheap structural
 * checks (dedup, in-memory burst, length) stay in index.ts before this is called.
 *
 * index.ts only orchestrates — all decision logic is here.
 */

import { Pool } from "pg";
import { createHash } from "node:crypto";
import { AgentConfig } from "./agent-config.js";
import { GUARD_NOTICES } from "../config/agent-instructions.js";

// ─── Config ─────────────────────────────────────────────────────────────────

export type GuardConfig = {
    maxInputChars: number;
    hardInputChars: number;
    rate: { burst10s: number; min: number; hour: number; day: number };
    newUserAgeMs: number;
    newUserBurst10s: number;
    repeatFloodN: number;
    linkSpamMax: number;
    strikeMute1: number;
    strikeMute1Ms: number;
    strikeMute2: number;
    strikeMute2Ms: number;
    strikeDecayMs: number;
    noticeCooldownMs: number;
    dailyBudgetUsd: number;
    dailyAnswerCap: number;
    budgetCacheMs: number;
    cacheEnabled: boolean;
    cacheTtlSeconds: number;
    price: { chatInPer1k: number; chatOutPer1k: number; embedPer1k: number };
};

function n(v: unknown, fallback: number): number {
    const x = Number(v);
    return Number.isFinite(x) && x >= 0 ? x : fallback;
}

/** Resolve config: agents.extra_config → env → defaults (mirrors getRetrievalTunables). */
export function getGuardConfig(config?: AgentConfig): GuardConfig {
    const ec = (config?.extra_config ?? {}) as Record<string, unknown>;
    const pick = (key: string, env: string, def: number) =>
        n(ec[key], n(process.env[env], def));

    return {
        maxInputChars: pick("max_input_chars", "MAX_INPUT_CHARS", 1000),
        hardInputChars: pick("hard_input_chars", "HARD_INPUT_CHARS", 4000),
        rate: {
            burst10s: pick("rate_burst_10s", "RATE_BURST_10S", 5),
            min: pick("rate_per_min", "RATE_PER_MIN", 15),
            hour: pick("rate_per_hour", "RATE_PER_HOUR", 120),
            day: pick("rate_per_day", "RATE_PER_DAY", 500),
        },
        newUserAgeMs: pick("new_user_age_ms", "NEW_USER_AGE_MS", 60000),
        newUserBurst10s: pick("new_user_burst_10s", "NEW_USER_BURST_10S", 3),
        repeatFloodN: pick("repeat_flood_n", "REPEAT_FLOOD_N", 3),
        linkSpamMax: pick("link_spam_max", "LINK_SPAM_MAX", 2),
        strikeMute1: pick("strike_mute_1", "STRIKE_MUTE_1", 3),
        strikeMute1Ms: pick("strike_mute_1_ms", "STRIKE_MUTE_1_DURATION_MS", 3_600_000),
        strikeMute2: pick("strike_mute_2", "STRIKE_MUTE_2", 5),
        strikeMute2Ms: pick("strike_mute_2_ms", "STRIKE_MUTE_2_DURATION_MS", 86_400_000),
        strikeDecayMs: pick("strike_decay_ms", "STRIKE_DECAY_MS", 86_400_000),
        noticeCooldownMs: pick("notice_cooldown_ms", "NOTICE_COOLDOWN_MS", 3_600_000),
        dailyBudgetUsd: pick("daily_budget_usd", "DAILY_BUDGET_USD", 5),
        dailyAnswerCap: pick("daily_answer_cap", "DAILY_ANSWER_CAP", 2000),
        budgetCacheMs: pick("budget_cache_ms", "BUDGET_CACHE_MS", 30000),
        cacheEnabled: (process.env.CACHE_ENABLED ?? "true") !== "false",
        cacheTtlSeconds: pick("cache_ttl_seconds", "CACHE_TTL_SECONDS", 3600),
        price: {
            chatInPer1k: n(process.env.OPENAI_PRICE_CHAT_INPUT_PER_1K, 0.0004),
            chatOutPer1k: n(process.env.OPENAI_PRICE_CHAT_OUTPUT_PER_1K, 0.0016),
            embedPer1k: n(process.env.OPENAI_PRICE_EMBED_PER_1K, 0.00002),
        },
    };
}

// ─── Types ──────────────────────────────────────────────────────────────────

export type GuardDecision =
    | { decision: "allow"; truncatedText: string }
    | { decision: "throttle"; reason: string; userMessage: string | null }
    | { decision: "block"; reason: string; userMessage: string | null }
    | { decision: "fallback"; reason: string };

export type GuardInput = {
    customerId: string;
    chatId: number;
    text: string;
    customerCreatedAt: string | null;
};

type AbuseStateRow = {
    strikes: number;
    muted_until: string | null;
    last_strike_at: string | null;
    last_text_hash: string | null;
    repeat_count: number;
    notice_sent_at: string | null;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

export function normalizeQuery(text: string): string {
    return text.toLowerCase().replace(/\s+/g, " ").trim().replace(/[.?!,;:]+$/u, "");
}

function sha256(text: string): string {
    return createHash("sha256").update(text).digest("hex");
}

const LINK_RE = /(https?:\/\/|t\.me\/|www\.)/gi;
function countLinks(text: string): number {
    return (text.match(LINK_RE) ?? []).length;
}

function floorMs(now: number, sizeMs: number): Date {
    return new Date(Math.floor(now / sizeMs) * sizeMs);
}

// ─── Layer: DB rate windows (atomic multi-window upsert) ──────────────────────

async function bumpRateWindows(
    pool: Pool,
    customerId: string,
    now: number,
): Promise<Record<string, number>> {
    const kinds = ["burst10s", "min", "hour", "day"];
    const starts = [
        floorMs(now, 10_000),
        floorMs(now, 60_000),
        floorMs(now, 3_600_000),
        floorMs(now, 86_400_000),
    ].map((d) => d.toISOString());

    const res = await pool.query<{ window_kind: string; count: number }>(
        `INSERT INTO rate_counters (customer_id, window_kind, window_start, count)
         SELECT $1, k, s::timestamptz, 1
         FROM unnest($2::text[], $3::text[]) AS t(k, s)
         ON CONFLICT (customer_id, window_kind, window_start)
         DO UPDATE SET count = rate_counters.count + 1
         RETURNING window_kind, count`,
        [customerId, kinds, starts],
    );
    const out: Record<string, number> = {};
    for (const r of res.rows) out[r.window_kind] = r.count;
    return out;
}

// ─── Budget kill-switch (in-memory cached) ────────────────────────────────────

let budgetCache: { until: number; exceeded: boolean } | null = null;

export async function isBudgetExceeded(pool: Pool, cfg: GuardConfig): Promise<boolean> {
    const now = Date.now();
    if (budgetCache && now < budgetCache.until) return budgetCache.exceeded;

    let exceeded = false;
    try {
        const r = await pool.query<{ spend: string; answers: string }>(
            `SELECT COALESCE(SUM(cost_usd),0) AS spend,
                    COUNT(*) FILTER (WHERE kind='chat') AS answers
             FROM token_usage
             WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')`,
        );
        const spend = Number(r.rows[0]?.spend ?? 0);
        const answers = Number(r.rows[0]?.answers ?? 0);
        exceeded = spend >= cfg.dailyBudgetUsd || answers >= cfg.dailyAnswerCap;
        if (exceeded) {
            console.warn(`[abuse-guard] BUDGET_EXCEEDED spend=$${spend.toFixed(4)} answers=${answers}`);
        }
    } catch (err) {
        console.error("[abuse-guard] budget check failed:", err instanceof Error ? err.message : err);
        exceeded = false; // fail open
    }
    budgetCache = { until: now + cfg.budgetCacheMs, exceeded };
    return exceeded;
}

// ─── Main entry: checkInbound ─────────────────────────────────────────────────

export async function checkInbound(
    pool: Pool,
    input: GuardInput,
    cfg: GuardConfig,
): Promise<GuardDecision> {
    const now = Date.now();
    const truncatedText = input.text.length > cfg.maxInputChars
        ? input.text.slice(0, cfg.maxInputChars)
        : input.text;

    // Load per-user abuse state (one row read).
    const stateRes = await pool.query<AbuseStateRow>(
        `SELECT strikes, muted_until, last_strike_at, last_text_hash, repeat_count, notice_sent_at
         FROM user_abuse_state WHERE customer_id = $1`,
        [input.customerId],
    );
    const state = stateRes.rows[0];

    // Strike decay.
    let strikes = state?.strikes ?? 0;
    if (state?.last_strike_at && now - Date.parse(state.last_strike_at) > cfg.strikeDecayMs) {
        strikes = 0;
    }
    const noticeSentAt = state?.notice_sent_at ? Date.parse(state.notice_sent_at) : 0;
    const canNotify = now - noticeSentAt > cfg.noticeCooldownMs;

    // Layer 4: active mute.
    if (state?.muted_until && Date.parse(state.muted_until) > now) {
        // Notice was sent when the mute was applied → stay silent.
        return { decision: "block", reason: "muted", userMessage: null };
    }

    const isNewUser =
        input.customerCreatedAt != null &&
        now - Date.parse(input.customerCreatedAt) < cfg.newUserAgeMs;

    // Layer 5: DB rate windows.
    const counts = await bumpRateWindows(pool, input.customerId, now);
    const caps = {
        burst10s: isNewUser ? cfg.newUserBurst10s : cfg.rate.burst10s,
        min: isNewUser ? Math.ceil(cfg.rate.min / 2) : cfg.rate.min,
        hour: isNewUser ? Math.ceil(cfg.rate.hour / 2) : cfg.rate.hour,
        day: cfg.rate.day,
    };
    const overWindow = (Object.keys(caps) as Array<keyof typeof caps>).find(
        (k) => (counts[k] ?? 0) > caps[k],
    );
    if (overWindow) {
        const msg = canNotify ? GUARD_NOTICES.throttle : null;
        if (msg) await this_stampNotice(pool, input.customerId, strikes, now);
        return { decision: "throttle", reason: `rate:${overWindow}`, userMessage: msg };
    }

    // Layer 6: behavioral signals.
    const hash = sha256(normalizeQuery(input.text));
    const repeatCount = state?.last_text_hash === hash ? (state?.repeat_count ?? 0) + 1 : 1;
    const links = countLinks(input.text);

    const linkSpam = links >= cfg.linkSpamMax || (links > 0 && isNewUser);
    const repeatFlood = repeatCount >= cfg.repeatFloodN;

    if (linkSpam || repeatFlood) {
        strikes += 1;
        let mutedUntil: Date | null = null;
        if (strikes >= cfg.strikeMute2) mutedUntil = new Date(now + cfg.strikeMute2Ms);
        else if (strikes >= cfg.strikeMute1) mutedUntil = new Date(now + cfg.strikeMute1Ms);

        const willNotify = canNotify;
        await upsertAbuseState(pool, input.customerId, {
            strikes,
            mutedUntil,
            lastStrikeAt: new Date(now),
            lastTextHash: hash,
            repeatCount,
            noticeSentAt: willNotify ? new Date(now) : null,
        });

        const reason = linkSpam ? "link_spam" : "repeat_flood";
        if (mutedUntil) {
            return { decision: "block", reason, userMessage: willNotify ? GUARD_NOTICES.muted : null };
        }
        return { decision: "throttle", reason, userMessage: willNotify ? GUARD_NOTICES.throttle : null };
    }

    // No abuse → persist behavioral memory (hash/repeat), keep decayed strikes.
    await upsertAbuseState(pool, input.customerId, {
        strikes,
        mutedUntil: null,
        lastStrikeAt: state?.last_strike_at ? new Date(Date.parse(state.last_strike_at)) : null,
        lastTextHash: hash,
        repeatCount,
        noticeSentAt: null,
    });

    // Layer 7: global budget kill-switch.
    if (await isBudgetExceeded(pool, cfg)) {
        return { decision: "fallback", reason: "budget" };
    }

    return { decision: "allow", truncatedText };
}

// helper referenced above for the throttle-notice stamp without full state rewrite
async function this_stampNotice(
    pool: Pool,
    customerId: string,
    strikes: number,
    now: number,
): Promise<void> {
    await pool.query(
        `INSERT INTO user_abuse_state (customer_id, strikes, notice_sent_at, updated_at)
         VALUES ($1, $2, to_timestamp($3 / 1000.0), NOW())
         ON CONFLICT (customer_id) DO UPDATE
         SET notice_sent_at = EXCLUDED.notice_sent_at, updated_at = NOW()`,
        [customerId, strikes, now],
    );
}

async function upsertAbuseState(
    pool: Pool,
    customerId: string,
    s: {
        strikes: number;
        mutedUntil: Date | null;
        lastStrikeAt: Date | null;
        lastTextHash: string;
        repeatCount: number;
        noticeSentAt: Date | null;
    },
): Promise<void> {
    await pool.query(
        `INSERT INTO user_abuse_state
           (customer_id, strikes, muted_until, last_strike_at, last_text_hash, repeat_count, notice_sent_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (customer_id) DO UPDATE SET
           strikes        = EXCLUDED.strikes,
           muted_until    = EXCLUDED.muted_until,
           last_strike_at = EXCLUDED.last_strike_at,
           last_text_hash = EXCLUDED.last_text_hash,
           repeat_count   = EXCLUDED.repeat_count,
           notice_sent_at = COALESCE(EXCLUDED.notice_sent_at, user_abuse_state.notice_sent_at),
           updated_at     = NOW()`,
        [
            customerId,
            s.strikes,
            s.mutedUntil ? s.mutedUntil.toISOString() : null,
            s.lastStrikeAt ? s.lastStrikeAt.toISOString() : null,
            s.lastTextHash,
            s.repeatCount,
            s.noticeSentAt ? s.noticeSentAt.toISOString() : null,
        ],
    );
}

// ─── Token accounting ─────────────────────────────────────────────────────────

export async function recordTokenUsage(
    pool: Pool,
    u: {
        customerId?: string | null;
        conversationId?: string | null;
        kind: "chat" | "embedding" | "moderation";
        model: string;
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    },
    cfg: GuardConfig,
): Promise<void> {
    let cost = 0;
    if (u.kind === "chat") {
        cost = (u.promptTokens / 1000) * cfg.price.chatInPer1k
             + (u.completionTokens / 1000) * cfg.price.chatOutPer1k;
    } else if (u.kind === "embedding") {
        cost = (u.totalTokens / 1000) * cfg.price.embedPer1k;
    }
    try {
        await pool.query(
            `INSERT INTO token_usage
               (customer_id, conversation_id, kind, model, prompt_tokens, completion_tokens, total_tokens, cost_usd)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
                u.customerId ?? null, u.conversationId ?? null, u.kind, u.model,
                u.promptTokens, u.completionTokens, u.totalTokens, cost,
            ],
        );
    } catch (err) {
        console.error("[abuse-guard] recordTokenUsage failed:", err instanceof Error ? err.message : err);
    }
}

// ─── Response cache ───────────────────────────────────────────────────────────

let kbVersionCache: { until: number; version: number } | null = null;

async function kbVersion(pool: Pool): Promise<number> {
    const now = Date.now();
    if (kbVersionCache && now < kbVersionCache.until) return kbVersionCache.version;
    let version = 0;
    try {
        const r = await pool.query<{ v: string | null }>(
            `SELECT COALESCE(MAX(extract(epoch FROM updated_at))::bigint, 0) AS v
             FROM kb_entries WHERE status = 'published'`,
        );
        version = Number(r.rows[0]?.v ?? 0);
    } catch {
        version = 0;
    }
    kbVersionCache = { until: now + 60_000, version };
    return version;
}

export async function getCachedAnswer(
    pool: Pool,
    normalizedQuery: string,
): Promise<string | null> {
    const version = await kbVersion(pool);
    const hash = sha256(normalizedQuery);
    const r = await pool.query<{ answer: string }>(
        `UPDATE response_cache SET hits = hits + 1
         WHERE query_hash = $1 AND kb_version = $2 AND expires_at > now()
         RETURNING answer`,
        [hash, version],
    );
    return r.rows[0]?.answer ?? null;
}

/**
 * Invalidate the response cache after a KB change so the live bot reflects edits
 * immediately (no stale-answer window). Resets the in-memory kb_version token and
 * clears cached answers. Call on any create/update/archive/delete of kb_entries.
 */
export async function invalidateKbCache(pool: Pool): Promise<void> {
    kbVersionCache = null;
    try {
        await pool.query(`DELETE FROM response_cache`);
    } catch (err) {
        console.error("[abuse-guard] cache invalidation failed:", err instanceof Error ? err.message : err);
    }
}

export async function putCachedAnswer(
    pool: Pool,
    normalizedQuery: string,
    answer: string,
    usedMatches: number,
    cfg: GuardConfig,
): Promise<void> {
    const version = await kbVersion(pool);
    const hash = sha256(normalizedQuery);
    try {
        await pool.query(
            `INSERT INTO response_cache (query_hash, answer, used_matches, kb_version, expires_at)
             VALUES ($1, $2, $3, $4, now() + ($5 || ' seconds')::interval)
             ON CONFLICT (query_hash) DO UPDATE SET
               answer = EXCLUDED.answer, used_matches = EXCLUDED.used_matches,
               kb_version = EXCLUDED.kb_version, expires_at = EXCLUDED.expires_at, hits = 0, created_at = now()`,
            [hash, answer, usedMatches, version, String(cfg.cacheTtlSeconds)],
        );
    } catch (err) {
        console.error("[abuse-guard] putCachedAnswer failed:", err instanceof Error ? err.message : err);
    }
}

// ─── Maintenance sweep ────────────────────────────────────────────────────────

export async function sweepGuardState(pool: Pool): Promise<void> {
    try {
        await pool.query(`DELETE FROM rate_counters WHERE window_start < now() - interval '2 days'`);
        await pool.query(`DELETE FROM response_cache WHERE expires_at < now()`);
    } catch (err) {
        console.error("[abuse-guard] sweep failed:", err instanceof Error ? err.message : err);
    }
}
