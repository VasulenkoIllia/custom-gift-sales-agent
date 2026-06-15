export interface OpenAiClientOptions {
    apiKey: string;
    baseUrl?: string;
    chatModel?: string;
    embeddingModel?: string;
    timeoutMs?: number;
}

type OpenAiUsage = {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
};

type OpenAiChatResponse = {
    choices?: Array<{
        message?: {
            content?: string | null;
        };
    }>;
    usage?: OpenAiUsage;
    error?: {
        message?: string;
    };
};

type OpenAiEmbeddingResponse = {
    data?: Array<{
        embedding?: number[];
    }>;
    usage?: OpenAiUsage;
    error?: {
        message?: string;
    };
};

type OpenAiModerationResponse = {
    results?: Array<{
        flagged?: boolean;
        categories?: Record<string, boolean>;
    }>;
    error?: {
        message?: string;
    };
};

/** Token usage for one OpenAI call (zeros when the provider omits usage). */
export type UsageInfo = {
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
};

export type ChatResult = { content: string; usage: UsageInfo };
export type EmbeddingResult = { embedding: number[]; usage: UsageInfo };
export type ModerationResult = { flagged: boolean; categories: string[] };

export class OpenAiClient {
    private readonly apiKey: string;
    private readonly baseUrl: string;
    private readonly chatModel: string;
    private readonly embeddingModel: string;
    private readonly timeoutMs: number;

    constructor(options: OpenAiClientOptions) {
        this.apiKey = options.apiKey.trim();
        this.baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
        this.chatModel = options.chatModel ?? "gpt-4.1-mini";
        this.embeddingModel = options.embeddingModel ?? "text-embedding-3-small";
        this.timeoutMs = options.timeoutMs ?? 20_000;
    }

    getEmbeddingModel(): string {
        return this.embeddingModel;
    }

    private usageFrom(model: string, usage?: OpenAiUsage): UsageInfo {
        return {
            model,
            promptTokens: usage?.prompt_tokens ?? 0,
            completionTokens: usage?.completion_tokens ?? 0,
            totalTokens: usage?.total_tokens ?? 0,
        };
    }

    /** Embedding + token usage. */
    async createEmbeddingWithUsage(input: string): Promise<EmbeddingResult> {
        const payload = await this.request<OpenAiEmbeddingResponse>("/embeddings", {
            model: this.embeddingModel,
            input,
        });

        const embedding = payload.data?.[0]?.embedding;
        if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
            throw new Error("OpenAI embedding response is empty.");
        }
        return { embedding, usage: this.usageFrom(this.embeddingModel, payload.usage) };
    }

    /** Chat completion + token usage. */
    async createChatCompletionWithUsage(
        systemPrompt: string,
        userPrompt: string,
    ): Promise<ChatResult> {
        const payload = await this.request<OpenAiChatResponse>("/chat/completions", {
            model: this.chatModel,
            temperature: 0.2,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
            ],
        });

        const content = payload.choices?.[0]?.message?.content?.trim();
        if (!content) {
            throw new Error("OpenAI chat completion response is empty.");
        }
        return { content, usage: this.usageFrom(this.chatModel, payload.usage) };
    }

    // Backward-compatible wrappers — unchanged signatures, drop usage.
    async createEmbedding(input: string): Promise<number[]> {
        return (await this.createEmbeddingWithUsage(input)).embedding;
    }

    async createChatCompletion(systemPrompt: string, userPrompt: string): Promise<string> {
        return (await this.createChatCompletionWithUsage(systemPrompt, userPrompt)).content;
    }

    /**
     * Content moderation via the free omni-moderation endpoint.
     * Caller should fail OPEN (proceed) on errors so moderation can't take the bot down.
     */
    async createModeration(input: string): Promise<ModerationResult> {
        const payload = await this.request<OpenAiModerationResponse>("/moderations", {
            model: "omni-moderation-latest",
            input,
        });
        const result = payload.results?.[0];
        const categories = result?.categories
            ? Object.entries(result.categories).filter(([, v]) => v).map(([k]) => k)
            : [];
        return { flagged: Boolean(result?.flagged), categories };
    }

    async createJsonCompletion(systemPrompt: string, userPrompt: string): Promise<unknown> {
        const payload = await this.request<OpenAiChatResponse>("/chat/completions", {
            model: this.chatModel,
            temperature: 0,
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
            ],
        });

        const content = payload.choices?.[0]?.message?.content?.trim();
        if (!content) {
            throw new Error("OpenAI JSON completion response is empty.");
        }
        return JSON.parse(content);
    }

    private async request<T>(path: string, body: unknown): Promise<T> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            const response = await fetch(`${this.baseUrl}${path}`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    "Content-Type": "application/json",
                    Accept: "application/json",
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });

            const json = await this.safeJson(response);
            if (!response.ok) {
                const errorMessage =
                    (json as { error?: { message?: string } })?.error?.message ??
                    JSON.stringify(json);
                throw new Error(`OpenAI API HTTP ${response.status}: ${errorMessage}`);
            }

            return json as T;
        } catch (error) {
            throw new Error(
                `OpenAI request failed: ${
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

export function createOpenAiClientFromEnv(): OpenAiClient {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error("Missing OPENAI_API_KEY. Add OPENAI_API_KEY to your environment.");
    }

    return new OpenAiClient({
        apiKey,
        baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
        chatModel: process.env.OPENAI_CHAT_MODEL || "gpt-4.1-mini",
        embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
        timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS || 20_000),
    });
}
