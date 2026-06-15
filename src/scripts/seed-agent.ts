/**
 * seed-agent.ts — Upsert the default support agent into the `agents` table.
 *
 * Idempotent: re-running updates the existing 'default' row from env vars.
 *   npm run seed:agent
 */
import { createDbPoolFromEnv } from "../lib/db.js";

async function main(): Promise<void> {
    const pool = createDbPoolFromEnv();

    const persona = process.env.AI_AGENT_NAME || "Соня";
    const language = process.env.AI_AGENT_LANGUAGE || "українська";
    const instructions = (process.env.AI_AGENT_SYSTEM_PROMPT_APPEND || "").trim();
    const model = process.env.OPENAI_CHAT_MODEL || "gpt-4.1-mini";

    await pool.query(
        `
        INSERT INTO agents (name, persona, instructions, model, language, is_active)
        VALUES ('default', $1, $2, $3, $4, TRUE)
        ON CONFLICT (name) DO UPDATE
        SET persona = EXCLUDED.persona,
            instructions = EXCLUDED.instructions,
            model = EXCLUDED.model,
            language = EXCLUDED.language,
            is_active = TRUE,
            updated_at = NOW()
        `,
        [persona, instructions, model, language],
    );

    console.log(`[seed-agent] upserted default agent (persona=${persona}, model=${model}).`);
    await pool.end();
}

main().catch((err) => {
    console.error("[seed-agent] failed:", err instanceof Error ? err.message : err);
    process.exit(1);
});
