/**
 * agent-config.ts — Loads agent configuration from the `agents` DB table.
 *
 * The `agents` table is the single source of truth for persona, instructions,
 * welcome/fallback messages, model, and language. Falls back to env vars when
 * the table is empty or the DB is unavailable.
 */

import { Pool } from "pg";

export type AgentConfig = {
    id: string;
    name: string;
    /** Display name shown to customers (e.g. "Соня"). */
    persona: string;
    /** Custom instructions appended to the system prompt. */
    instructions: string;
    welcome_message: string;
    fallback_message: string;
    model: string;
    language: string;
    extra_config: Record<string, unknown>;
    is_active: boolean;
};

type AgentRow = {
    id: string;
    name: string;
    persona: string;
    instructions: string;
    welcome_message: string;
    fallback_message: string;
    model: string;
    language: string;
    extra_config: Record<string, unknown>;
    is_active: boolean;
};

/**
 * Loads the active agent config from the DB.
 * Returns undefined when no active agent is found — callers fall back to env vars.
 */
export async function loadAgentConfig(pool: Pool): Promise<AgentConfig | undefined> {
    try {
        const result = await pool.query<AgentRow>(
            `SELECT id, name, persona, instructions, welcome_message, fallback_message,
                    model, language, extra_config, is_active
             FROM agents
             WHERE name = 'default' AND is_active = TRUE
             LIMIT 1`,
        );

        if (result.rows.length === 0) {
            return undefined;
        }

        return result.rows[0];
    } catch (err) {
        console.warn(
            "[agent-config] Failed to load agent config from DB, falling back to env vars:",
            err instanceof Error ? err.message : err,
        );
        return undefined;
    }
}

// ─── Retrieval tunables (stored in agents.extra_config, env as fallback) ────────

export type RetrievalTunables = {
    topK: number;
    vectorThreshold: number;
    categoryBoost: number;
};

function num(v: unknown, fallback: number): number {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Reads retrieval tunables from agent.extra_config, falling back to env/defaults. */
export function getRetrievalTunables(config?: AgentConfig): RetrievalTunables {
    const ec = (config?.extra_config ?? {}) as Record<string, unknown>;
    return {
        topK: num(ec.top_k, Number(process.env.AI_CONTEXT_TOP_K || 6)),
        vectorThreshold: num(ec.vector_threshold, Number(process.env.KB_VECTOR_THRESHOLD ?? 0.45)),
        categoryBoost: num(ec.category_boost, Number(process.env.KB_CATEGORY_BOOST ?? 1.25)),
    };
}

export type AgentConfigUpdate = {
    persona?: string;
    instructions?: string;
    fallback_message?: string;
    model?: string;
    language?: string;
    extra_config?: Record<string, unknown>;
};

/** Updates the default agent row. Returns the fresh config. */
export async function updateAgentConfig(
    pool: Pool,
    update: AgentConfigUpdate,
): Promise<AgentConfig | undefined> {
    await pool.query(
        `UPDATE agents SET
            persona          = COALESCE($1, persona),
            instructions     = COALESCE($2, instructions),
            fallback_message = COALESCE($3, fallback_message),
            model            = COALESCE($4, model),
            language         = COALESCE($5, language),
            extra_config     = COALESCE($6::jsonb, extra_config),
            updated_at       = NOW()
         WHERE name = 'default'`,
        [
            update.persona ?? null,
            update.instructions ?? null,
            update.fallback_message ?? null,
            update.model ?? null,
            update.language ?? null,
            update.extra_config ? JSON.stringify(update.extra_config) : null,
        ],
    );
    return loadAgentConfig(pool);
}
