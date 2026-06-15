import http from "node:http";
import { createDbPoolFromEnv } from "./lib/db.js";
import {
    getOrCreateOpenConversation,
    recordTelegramUpdate,
    saveInboundMessage,
    saveOutboundMessage,
    upsertTelegramCustomer,
} from "./lib/chat-store.js";
import { createTelegramClientFromEnv } from "./lib/telegram-client.js";
import { createOpenAiClientFromEnv } from "./lib/openai-client.js";
import { AiConsultantService } from "./lib/ai-consultant.js";
import { handleAdminRequest } from "./lib/admin-api.js";
import { checkInbound, sweepGuardState } from "./lib/abuse-guard.js";
import { TelegramUpdate } from "./types/telegram.js";

const appName = process.env.APP_NAME || "app";
const port = Number(process.env.PORT || 3000);
const nodeEnv = process.env.NODE_ENV || "development";
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || "";

// Per-chat rate limiter (in-memory, resets on process restart).
const chatLastProcessed = new Map<number, number>();
const RATE_LIMIT_MS = Number(process.env.CHAT_RATE_LIMIT_MS || 1500);

function isRateLimited(chatId: number): boolean {
    const now = Date.now();
    const last = chatLastProcessed.get(chatId) ?? 0;
    if (now - last < RATE_LIMIT_MS) {
        return true;
    }
    chatLastProcessed.set(chatId, now);
    return false;
}

const dbPool = createDbPoolFromEnv();
const telegramClient = process.env.TELEGRAM_BOT_TOKEN
    ? createTelegramClientFromEnv()
    : null;
const openAiClient = process.env.OPENAI_API_KEY ? createOpenAiClientFromEnv() : null;
const aiConsultantService = new AiConsultantService({
    pool: dbPool,
    openAiClient,
});

function jsonResponse(
    res: http.ServerResponse,
    statusCode: number,
    payload: Record<string, unknown>,
): void {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
}

const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 1_000_000); // 1 MB anti-DoS cap

async function readJsonBody<T>(req: http.IncomingMessage): Promise<T> {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of req) {
        const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        total += buf.length;
        if (total > MAX_BODY_BYTES) {
            throw new Error("Request body too large");
        }
        chunks.push(buf);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    return (text ? JSON.parse(text) : {}) as T;
}

function extractText(update: TelegramUpdate): string {
    return (update.message?.text ?? update.edited_message?.text ?? "").trim();
}

function extractTelegramMessageId(responsePayload: unknown): string | null {
    if (!responsePayload || typeof responsePayload !== "object") return null;
    const result = (responsePayload as { result?: unknown }).result;
    if (!result || typeof result !== "object") return null;
    const messageId = (result as { message_id?: unknown }).message_id;
    if (typeof messageId === "number" || typeof messageId === "string") {
        return String(messageId);
    }
    return null;
}

async function sendTelegramMessage(
    chatId: string,
    text: string,
): Promise<Record<string, unknown>> {
    if (!telegramClient) {
        return { ok: false, description: "TELEGRAM_BOT_TOKEN is not set" };
    }
    try {
        return (await telegramClient.sendMessage(chatId, text)) as unknown as Record<
            string,
            unknown
        >;
    } catch (error) {
        return {
            ok: false,
            description: error instanceof Error ? error.message : "Telegram send failed",
        };
    }
}

async function processTelegramUpdate(update: TelegramUpdate): Promise<void> {
    // Layer 0: structural drops (cheapest, no DB, no notice).
    if (!update.message || !update.message.from) return;
    if (update.message.from.is_bot) return;

    const rawText = extractText(update);
    if (!rawText) return;

    const guardCfg = await aiConsultantService.resolveGuardConfig();

    // Layer 1: hard length cap — silently drop absurd payloads.
    if (rawText.length > guardCfg.hardInputChars) {
        console.log(`[${appName}] dropped oversized message chat_id=${update.message.chat.id}`);
        return;
    }

    // Layer 2: in-memory burst gate (cheapest flood absorber, pre-DB).
    if (isRateLimited(update.message.chat.id)) {
        console.log(
            `[${appName}] rate-limited chat_id=${update.message.chat.id} update_id=${update.update_id}`,
        );
        return;
    }

    // Layer 3: dedup.
    const isNewUpdate = await recordTelegramUpdate(dbPool, update.update_id, update);
    if (!isNewUpdate) return;

    const customer = await upsertTelegramCustomer(dbPool, update.message);
    const conversation = await getOrCreateOpenConversation(dbPool, customer.id, "telegram");

    // Layers 4–7: DB-backed abuse guard (mute / rate windows / behavioral / budget).
    const guard = await checkInbound(
        dbPool,
        {
            customerId: customer.id,
            chatId: update.message.chat.id,
            text: rawText,
            customerCreatedAt: customer.created_at,
        },
        guardCfg,
    );

    if (guard.decision === "throttle" || guard.decision === "block") {
        console.warn(
            `[${appName}] guard ${guard.decision} reason=${guard.reason} customer_id=${customer.id}`,
        );
        if (guard.userMessage) {
            await sendTelegramMessage(String(update.message.chat.id), guard.userMessage);
        }
        return; // no inbound save, no LLM
    }

    if (guard.decision === "fallback") {
        const fallbackText = await aiConsultantService.fallbackMessage();
        await sendTelegramMessage(String(update.message.chat.id), fallbackText);
        return; // budget exceeded — no LLM
    }

    const text = guard.truncatedText;

    await saveInboundMessage(dbPool, {
        conversationId: conversation.id,
        customerId: customer.id,
        channelMessageId: String(update.message.message_id),
        textContent: text,
        payload: update,
    });

    const consultation = await aiConsultantService.generateReply({
        customerId: customer.id,
        conversationId: conversation.id,
        userText: text,
    });

    const consultationResponse = await sendTelegramMessage(
        String(update.message.chat.id),
        consultation.text,
    );

    await saveOutboundMessage(dbPool, {
        conversationId: conversation.id,
        customerId: customer.id,
        channelMessageId: extractTelegramMessageId(consultationResponse),
        textContent: consultation.text,
        payload: {
            telegram: consultationResponse,
            ai: {
                source: consultation.source,
                used_matches: consultation.usedMatches,
                detected_category: consultation.detectedCategory,
            },
        },
    });
}

async function handleTelegramWebhook(
    req: http.IncomingMessage,
    res: http.ServerResponse,
): Promise<void> {
    if (webhookSecret) {
        const token = req.headers["x-telegram-bot-api-secret-token"];
        if (token !== webhookSecret) {
            jsonResponse(res, 401, { error: "Invalid webhook secret token" });
            return;
        }
    }

    const payload = await readJsonBody<TelegramUpdate>(req);
    // Respond immediately so Telegram doesn't retry on slow LLM calls.
    jsonResponse(res, 200, { ok: true });
    void processTelegramUpdate(payload).catch((err) => {
        console.error(
            `[${appName}] processTelegramUpdate failed`,
            err instanceof Error ? err.message : err,
        );
    });
}

const server = http.createServer(async (req, res) => {
    try {
        if (req.method === "GET" && req.url === "/health") {
            jsonResponse(res, 200, { status: "ok", app: appName });
            return;
        }

        if (req.method === "POST" && req.url === "/webhooks/telegram") {
            await handleTelegramWebhook(req, res);
            return;
        }

        // Admin KB panel + API (Basic-auth gated inside the handler).
        if (req.url && req.url.startsWith("/admin")) {
            await handleAdminRequest(req, res, {
                pool: dbPool,
                openAiClient,
                consultant: aiConsultantService,
            });
            return;
        }

        jsonResponse(res, 404, {
            app: appName,
            status: "not_found",
            method: req.method,
            url: req.url,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.error(
            `[${appName}] request failed`,
            error instanceof Error ? error.message : error,
        );
        jsonResponse(res, 500, {
            error: "Internal server error",
            timestamp: new Date().toISOString(),
        });
    }
});

server.listen(port, () => {
    console.log(`[${appName}] listening on port ${port} in ${nodeEnv} mode`);
});

// Periodic cleanup of expired rate buckets + cache (anti-bloat).
const SWEEP_MS = Number(process.env.SWEEP_MS || 300_000);
const sweepTimer = setInterval(() => {
    void sweepGuardState(dbPool);
}, SWEEP_MS);

async function shutdown(signal: string): Promise<void> {
    console.log(`[${appName}] received ${signal}, shutting down`);
    clearInterval(sweepTimer);
    server.close(async () => {
        await dbPool.end();
        process.exit(0);
    });
}

process.on("SIGINT", () => {
    void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
});
