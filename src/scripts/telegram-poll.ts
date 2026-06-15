import { createDbPoolFromEnv } from "../lib/db.js";
import { createTelegramClientFromEnv } from "../lib/telegram-client.js";
import { TelegramUpdate } from "../types/telegram.js";

const LOCAL_WEBHOOK_URL =
    process.env.TELEGRAM_LOCAL_WEBHOOK_URL ||
    `http://127.0.0.1:${process.env.PORT || "3000"}/webhooks/telegram`;
const POLL_TIMEOUT_SEC = Number(process.env.TELEGRAM_POLL_TIMEOUT_SEC || 25);
const POLL_LIMIT = Number(process.env.TELEGRAM_POLL_LIMIT || 100);
const IDLE_SLEEP_MS = Number(process.env.TELEGRAM_POLL_IDLE_MS || 500);
const POLL_REQUEST_TIMEOUT_MS = Number(
    process.env.TELEGRAM_POLL_REQUEST_TIMEOUT_MS || POLL_TIMEOUT_SEC * 1000 + 5000,
);
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "";

function parseArgs(args: string[]): { once: boolean } {
    return {
        once: args.includes("--once"),
    };
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function getInitialOffset(): Promise<number> {
    const pool = createDbPoolFromEnv();
    try {
        const result = await pool.query<{ offset: string }>(
            `
            SELECT COALESCE(MAX(update_id), 0) + 1 AS offset
            FROM telegram_updates
            `,
        );
        return Number(result.rows[0]?.offset ?? "1");
    } finally {
        await pool.end();
    }
}

async function forwardToLocalWebhook(update: TelegramUpdate): Promise<void> {
    const response = await fetch(LOCAL_WEBHOOK_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(WEBHOOK_SECRET
                ? { "x-telegram-bot-api-secret-token": WEBHOOK_SECRET }
                : {}),
        },
        body: JSON.stringify(update),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Local webhook HTTP ${response.status}: ${text}`);
    }
}

async function run(): Promise<void> {
    const { once } = parseArgs(process.argv.slice(2));
    const telegramClient = createTelegramClientFromEnv({
        timeoutMs: Math.max(POLL_REQUEST_TIMEOUT_MS, POLL_TIMEOUT_SEC * 1000 + 1000),
    });
    let offset = await getInitialOffset();

    console.log(
        `Telegram poll started. localWebhook=${LOCAL_WEBHOOK_URL}, offset=${offset}, once=${once}, requestTimeoutMs=${Math.max(POLL_REQUEST_TIMEOUT_MS, POLL_TIMEOUT_SEC * 1000 + 1000)}`,
    );

    while (true) {
        const updatesResponse = await telegramClient.getUpdates({
            offset,
            limit: POLL_LIMIT,
            timeout: POLL_TIMEOUT_SEC,
            allowed_updates: ["message", "edited_message"],
        });

        if (!updatesResponse.ok) {
            throw new Error(updatesResponse.description || "Telegram getUpdates failed");
        }

        if (updatesResponse.result.length === 0) {
            if (once) {
                break;
            }
            await sleep(IDLE_SLEEP_MS);
            continue;
        }

        let forwardFailed = false;
        for (const update of updatesResponse.result) {
            try {
                await forwardToLocalWebhook(update);
                offset = update.update_id + 1;
            } catch (err) {
                // Server briefly down (e.g. restart). Don't advance the offset and
                // don't crash — retry this update next poll. Dedup (telegram_updates
                // ON CONFLICT) makes reprocessing safe.
                console.error(
                    `Forward failed (will retry): ${err instanceof Error ? err.message : err}`,
                );
                forwardFailed = true;
                break;
            }
        }

        if (forwardFailed) {
            await sleep(2000); // back off before retrying the same offset
        }

        if (once) {
            break;
        }
    }

    console.log(`Telegram poll finished. nextOffset=${offset}`);
}

run().catch((error) => {
    console.error(
        error instanceof Error
            ? error.message
            : "Unknown telegram polling worker error",
    );
    process.exit(1);
});
