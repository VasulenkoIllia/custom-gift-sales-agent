import {
    TelegramGetUpdatesParams,
    TelegramGetUpdatesResponse,
    TelegramSendMessageResponse,
} from "../types/telegram.js";

export interface TelegramClientOptions {
    botToken: string;
    baseUrl?: string;
    timeoutMs?: number;
}

export class TelegramClient {
    private readonly botToken: string;
    private readonly baseUrl: string;
    private readonly timeoutMs: number;

    constructor(options: TelegramClientOptions) {
        this.botToken = options.botToken.trim();
        this.baseUrl = (options.baseUrl ?? "https://api.telegram.org").replace(/\/+$/, "");
        this.timeoutMs = options.timeoutMs ?? 10_000;
    }

    async sendMessage(chatId: string, text: string): Promise<TelegramSendMessageResponse> {
        return this.request<TelegramSendMessageResponse>("sendMessage", {
            chat_id: chatId,
            text,
        });
    }

    async getUpdates(
        params: TelegramGetUpdatesParams = {},
    ): Promise<TelegramGetUpdatesResponse> {
        const query = new URLSearchParams();
        if (params.offset !== undefined) {
            query.set("offset", String(params.offset));
        }
        if (params.limit !== undefined) {
            query.set("limit", String(params.limit));
        }
        if (params.timeout !== undefined) {
            query.set("timeout", String(params.timeout));
        }
        if (params.allowed_updates && params.allowed_updates.length > 0) {
            query.set("allowed_updates", JSON.stringify(params.allowed_updates));
        }

        const suffix = query.toString();
        const method = suffix ? `getUpdates?${suffix}` : "getUpdates";
        return this.request<TelegramGetUpdatesResponse>(method, undefined, "GET");
    }

    private async request<T>(
        method: string,
        payload?: Record<string, unknown>,
        httpMethod: "GET" | "POST" = "POST",
    ): Promise<T> {
        const url = `${this.baseUrl}/bot${this.botToken}/${method}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            const response = await fetch(url, {
                method: httpMethod,
                headers: {
                    Accept: "application/json",
                    ...(payload ? { "Content-Type": "application/json" } : {}),
                },
                ...(payload ? { body: JSON.stringify(payload) } : {}),
                signal: controller.signal,
            });

            const json = await this.safeJson(response);
            if (!response.ok) {
                throw new Error(
                    `Telegram API HTTP ${response.status}: ${JSON.stringify(json)}`,
                );
            }

            return json as T;
        } catch (error) {
            throw new Error(
                `Telegram request failed: ${
                    error instanceof Error ? error.message : "unknown error"
                }`,
            );
        } finally {
            clearTimeout(timeoutId);
        }
    }

    private async safeJson(response: Response): Promise<unknown> {
        try {
            return await response.json();
        } catch {
            return null;
        }
    }
}

export function createTelegramClientFromEnv(
    overrides: Partial<Omit<TelegramClientOptions, "botToken">> = {},
): TelegramClient {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const baseUrl =
        overrides.baseUrl ||
        process.env.TELEGRAM_API_BASE_URL ||
        "https://api.telegram.org";
    const timeoutMs =
        overrides.timeoutMs ?? Number(process.env.TELEGRAM_TIMEOUT_MS || 10_000);

    if (!botToken) {
        throw new Error(
            "Missing TELEGRAM_BOT_TOKEN. Add TELEGRAM_BOT_TOKEN to your environment.",
        );
    }

    return new TelegramClient({
        botToken,
        baseUrl,
        timeoutMs,
    });
}
