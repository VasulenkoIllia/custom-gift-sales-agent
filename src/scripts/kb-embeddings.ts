/**
 * kb-embeddings.ts — Generate embeddings for KB entries.
 *
 * Picks up published `kb_entries` where embedding IS NULL and embeds their
 * SEARCH KEY (question + aliases) — never the answer. Run after importing or
 * after editing entries in the admin panel.
 *
 *   npm run embeddings:kb
 *
 * Flags: --batch-size=N --max-items=N --sleep-ms=N
 * Env:   EMBEDDING_BATCH_SIZE, EMBEDDING_MAX_ITEMS, EMBEDDING_SLEEP_MS
 */
import { getEmbeddableKbEntries, upsertKbEmbedding } from "../lib/rag.js";
import { createDbPoolFromEnv } from "../lib/db.js";
import { createOpenAiClientFromEnv } from "../lib/openai-client.js";

type ScriptOptions = {
    batchSize: number;
    maxItems: number;
    sleepMs: number;
};

function toPositiveInt(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return Math.floor(parsed);
}

function parseOptions(args: string[]): ScriptOptions {
    const options: ScriptOptions = {
        batchSize: toPositiveInt(process.env.EMBEDDING_BATCH_SIZE, 40),
        maxItems: toPositiveInt(process.env.EMBEDDING_MAX_ITEMS, 0),
        sleepMs: toPositiveInt(process.env.EMBEDDING_SLEEP_MS, 50),
    };
    for (const arg of args) {
        if (arg.startsWith("--batch-size=")) {
            options.batchSize = toPositiveInt(arg.split("=")[1], options.batchSize);
        } else if (arg.startsWith("--max-items=")) {
            options.maxItems = toPositiveInt(arg.split("=")[1], options.maxItems);
        } else if (arg.startsWith("--sleep-ms=")) {
            options.sleepMs = toPositiveInt(arg.split("=")[1], options.sleepMs);
        }
    }
    return options;
}

function formatError(error: unknown): string {
    return error instanceof Error ? error.message : "Unknown error";
}

async function sleep(ms: number): Promise<void> {
    if (ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
    const options = parseOptions(process.argv.slice(2));
    if (options.batchSize <= 0) {
        throw new Error("EMBEDDING_BATCH_SIZE must be greater than zero.");
    }

    const pool = createDbPoolFromEnv();
    const openAiClient = createOpenAiClientFromEnv();

    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    let batch = 0;
    const failedIds = new Set<string>();

    try {
        while (true) {
            const remaining =
                options.maxItems > 0 ? options.maxItems - processed : options.batchSize;
            if (options.maxItems > 0 && remaining <= 0) break;

            const limit =
                options.maxItems > 0 ? Math.min(options.batchSize, remaining) : options.batchSize;

            const entries = await getEmbeddableKbEntries(pool, limit, Array.from(failedIds));
            if (entries.length === 0) break;

            batch += 1;
            let successInBatch = 0;

            for (const entry of entries) {
                processed += 1;
                try {
                    const embedding = await openAiClient.createEmbedding(entry.search_key);
                    await upsertKbEmbedding(pool, entry.id, embedding);
                    succeeded += 1;
                    successInBatch += 1;
                } catch (error) {
                    failed += 1;
                    failedIds.add(entry.id);
                    console.error(`[kb-embeddings] entry ${entry.id} failed: ${formatError(error)}`);
                }
                await sleep(options.sleepMs);
            }

            console.log(
                `[kb-embeddings] batch ${batch}: fetched=${entries.length}, succeeded=${succeeded}, failed=${failed}`,
            );

            if (successInBatch === 0) {
                console.warn(
                    "[kb-embeddings] no successful embeddings in last batch, stopping to avoid infinite retries.",
                );
                break;
            }
        }

        console.log(
            `[kb-embeddings] done: processed=${processed}, succeeded=${succeeded}, failed=${failed}, excluded=${failedIds.size}`,
        );
    } finally {
        await pool.end();
    }
}

main().catch((error) => {
    console.error(`[kb-embeddings] ${formatError(error)}`);
    process.exit(1);
});
