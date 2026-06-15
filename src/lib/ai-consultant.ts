/**
 * ai-consultant.ts — Support consultation orchestrator.
 *
 * Flow:
 *   1. Build a retrieval query from the current message (+ last user turn for
 *      short follow-ups, so "а якщо 5 ГГц?" resolves against the prior question
 *      WITHOUT dragging in the agent's verbose previous answer).
 *   2. Detect a category (keyword-based) for a soft retrieval boost.
 *   3. Hybrid search over the published KB (vector + full-text + trigram).
 *   4. Ask the LLM to answer ONLY from the retrieved KNOWLEDGE_BASE.
 */

import { Pool } from "pg";
import {
    ConversationMessage,
    getRecentConversationMessages,
} from "./chat-store.js";
import { OpenAiClient } from "./openai-client.js";
import { search, formatContext, KbMatch } from "./rag.js";
import { AgentConfig, loadAgentConfig, getRetrievalTunables } from "./agent-config.js";
import {
    GuardConfig,
    getGuardConfig,
    recordTokenUsage,
    getCachedAnswer,
    putCachedAnswer,
    normalizeQuery,
} from "./abuse-guard.js";
import { detectCategory } from "../config/support-categories.js";
import {
    CONVERSATION_FORMAT,
    FALLBACK_REPLIES,
    PROMPTS,
} from "../config/agent-instructions.js";

type ConsultantDependencies = {
    pool: Pool;
    openAiClient: OpenAiClient | null;
    /** Pre-loaded agent config. Falls back to env vars when omitted. */
    agentConfig?: AgentConfig;
};

export type ConsultationReplyResult = {
    text: string;
    source: "llm" | "fallback";
    usedMatches: number;
    /** Detected category for the user message (telemetry / debugging). */
    detectedCategory: string | null;
};

// Short messages are treated as potential follow-ups needing prior context.
const FOLLOWUP_MAX_LEN = Number(process.env.FOLLOWUP_MAX_LEN || 30);
const FOLLOWUP_MARKERS = ["а якщо", "а як", "а що", "а коли", "тоді", "воно", "це ", "а де"];

function normalizeText(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

/**
 * Builds the retrieval query. For short/elliptical follow-ups, prepend ONLY the
 * last inbound (user) message — not the assistant's answer, which is the noise
 * source that pollutes embeddings.
 */
function buildRetrievalQuery(userText: string, history: ConversationMessage[]): string {
    const current = normalizeText(userText);
    const looksLikeFollowup =
        current.length <= FOLLOWUP_MAX_LEN ||
        FOLLOWUP_MARKERS.some((m) => current.toLowerCase().startsWith(m));

    if (!looksLikeFollowup) {
        return current;
    }

    // Find the previous inbound message (excluding the current one, which may or
    // may not be persisted yet).
    const inbound = history.filter((m) => m.direction === "inbound" && m.text_content);
    const prevUser = inbound.length > 0 ? normalizeText(inbound[inbound.length - 1].text_content!) : "";
    // Avoid duplicating the current message if it's already the last inbound row.
    if (!prevUser || prevUser === current) {
        return current;
    }
    return `${prevUser}\n${current}`;
}

function formatConversationHistory(messages: ConversationMessage[]): string {
    if (messages.length === 0) {
        return CONVERSATION_FORMAT.emptyHistory;
    }
    return messages
        .map((message) => {
            const role = CONVERSATION_FORMAT.roleLabels[message.direction];
            return `${role}: ${normalizeText(message.text_content ?? "")}`.trim();
        })
        .join("\n");
}

// ─── System prompt ──────────────────────────────────────────────────────────

export function buildSystemPrompt(config?: AgentConfig): string {
    const agentName = config?.persona || config?.name || process.env.AI_AGENT_NAME || "Соня";
    return PROMPTS.buildSystemPrompt({
        shopName: process.env.SHOP_NAME || "INTELLECT",
        agentName,
        language: config?.language || process.env.AI_AGENT_LANGUAGE || "українська",
        customAppend: config?.instructions || (process.env.AI_AGENT_SYSTEM_PROMPT_APPEND || "").trim(),
    });
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class AiConsultantService {
    private readonly pool: Pool;
    private readonly openAiClient: OpenAiClient | null;
    private agentConfig: AgentConfig | undefined;

    constructor(dependencies: ConsultantDependencies) {
        this.pool = dependencies.pool;
        this.openAiClient = dependencies.openAiClient;
        this.agentConfig = dependencies.agentConfig;
    }

    /** Reloads agent configuration from the DB (call after editing the agents table). */
    async reloadAgentConfig(): Promise<void> {
        this.agentConfig = await loadAgentConfig(this.pool);
    }

    private async getAgentConfig(): Promise<AgentConfig | undefined> {
        if (!this.agentConfig) {
            this.agentConfig = await loadAgentConfig(this.pool);
        }
        return this.agentConfig;
    }

    /** Guard config resolved from the cached agent config (env + extra_config). */
    async resolveGuardConfig(): Promise<GuardConfig> {
        return getGuardConfig(await this.getAgentConfig());
    }

    /** The configured fallback message (used for budget kill-switch + no-LLM paths). */
    async fallbackMessage(): Promise<string> {
        const cfg = await this.getAgentConfig();
        return cfg?.fallback_message?.trim() || FALLBACK_REPLIES.noMatches;
    }

    async generateReply(args: {
        customerId: string;
        conversationId: string;
        userText: string;
    }): Promise<ConsultationReplyResult> {
        const history = await getRecentConversationMessages(this.pool, args.conversationId, 8);
        return this.answer(args.userText, history, {
            customerId: args.customerId,
            conversationId: args.conversationId,
            useCache: true,
        });
    }

    /**
     * Side-effect-free preview used by the admin "Test answer" panel: runs the
     * exact retrieval + LLM the live bot would, with empty history. Does NOT use
     * or write the response cache (so testing never serves/pollutes cached answers).
     */
    async previewReply(userText: string): Promise<ConsultationReplyResult & { matches: KbMatch[] }> {
        return this.answer(userText, [], { includeMatches: true, useCache: false });
    }

    /** Core retrieve → answer pipeline shared by live replies and previews. */
    private async answer(
        userText: string,
        history: ConversationMessage[],
        opts: {
            includeMatches?: boolean;
            useCache?: boolean;
            customerId?: string;
            conversationId?: string;
        } = {},
    ): Promise<ConsultationReplyResult & { matches: KbMatch[] }> {
        const agentConfig = await this.getAgentConfig();
        const tunables = getRetrievalTunables(agentConfig);
        const guardCfg = getGuardConfig(agentConfig);

        const detectedCategory = detectCategory(userText);
        // "No prior context" = at most the current inbound message in history (the
        // inbound row is persisted before generateReply runs). Follow-ups, whose
        // answer depends on earlier turns, have length >= 2 and are NOT cached.
        const noHistory = history.length <= 1;
        const cacheable = Boolean(opts.useCache) && guardCfg.cacheEnabled && noHistory;
        const normQuery = normalizeQuery(userText);

        // Response cache (first message only) — skips BOTH OpenAI calls on a hit.
        if (cacheable) {
            const cached = await getCachedAnswer(this.pool, normQuery).catch(() => null);
            if (cached !== null) {
                return {
                    text: cached, source: "llm", usedMatches: 0,
                    detectedCategory, matches: [],
                };
            }
        }

        const retrievalQuery = buildRetrievalQuery(userText, history);
        const matches: KbMatch[] = await search(this.pool, this.openAiClient, retrievalQuery, {
            limit: tunables.topK,
            category: detectedCategory,
            vectorThreshold: tunables.vectorThreshold,
            categoryBoost: tunables.categoryBoost,
            onUsage: (u) => {
                void recordTokenUsage(this.pool, {
                    customerId: opts.customerId ?? null,
                    conversationId: opts.conversationId ?? null,
                    kind: "embedding",
                    model: u.model,
                    promptTokens: u.promptTokens,
                    completionTokens: u.completionTokens,
                    totalTokens: u.totalTokens,
                }, guardCfg);
            },
        });

        const knowledgeBaseContext = matches.length > 0 ? formatContext(matches) : "";
        const conversationHistory = formatConversationHistory(history);
        const fallback = agentConfig?.fallback_message?.trim() || FALLBACK_REPLIES.noMatches;

        let replyText = fallback;
        let source: "llm" | "fallback" = "fallback";

        if (this.openAiClient) {
            const resolved = await this.openAiClient
                .createChatCompletionWithUsage(
                    buildSystemPrompt(agentConfig),
                    PROMPTS.buildUserPrompt({ userText, conversationHistory, knowledgeBaseContext }),
                )
                .catch((error: unknown) => {
                    console.error(
                        "[ai-consultant] llm generation failed",
                        error instanceof Error ? error.message : error,
                    );
                    return null;
                });

            if (resolved !== null) {
                replyText = resolved.content;
                source = "llm";
                void recordTokenUsage(this.pool, {
                    customerId: opts.customerId ?? null,
                    conversationId: opts.conversationId ?? null,
                    kind: "chat",
                    model: resolved.usage.model,
                    promptTokens: resolved.usage.promptTokens,
                    completionTokens: resolved.usage.completionTokens,
                    totalTokens: resolved.usage.totalTokens,
                }, guardCfg);

                if (cacheable) {
                    void putCachedAnswer(this.pool, normQuery, replyText, matches.length, guardCfg);
                }
            }
        }

        return {
            text: replyText,
            source,
            usedMatches: matches.length,
            detectedCategory,
            matches: opts.includeMatches ? matches : [],
        };
    }
}
