import { Pool } from "pg";
import { withTransaction } from "./db.js";
import { TelegramMessage } from "../types/telegram.js";

export type CustomerRecord = {
    id: string;
    channel: string;
    external_user_id: string;
    profile: Record<string, unknown>;
    created_at: string;
};

export type ConversationRecord = {
    id: string;
    customer_id: string;
    channel: string;
    status: string;
};

export type ConversationMessage = {
    direction: "inbound" | "outbound";
    text_content: string | null;
    created_at: string;
};

export async function recordTelegramUpdate(
    pool: Pool,
    updateId: number,
    payload: unknown,
): Promise<boolean> {
    const result = await pool.query(
        `
        INSERT INTO telegram_updates (update_id, payload)
        VALUES ($1, $2::jsonb)
        ON CONFLICT (update_id) DO NOTHING
        RETURNING update_id
        `,
        [updateId, JSON.stringify(payload)],
    );

    return result.rowCount === 1;
}

export async function upsertTelegramCustomer(
    pool: Pool,
    message: TelegramMessage,
): Promise<CustomerRecord> {
    if (!message.from) {
        throw new Error("Telegram message does not contain sender (from).");
    }

    const fullName = `${message.from.first_name ?? ""} ${message.from.last_name ?? ""}`
        .trim()
        .trim();
    const profile = {
        telegram_chat_id: String(message.chat.id),
        telegram_user_id: String(message.from.id),
        first_name: message.from.first_name ?? null,
        last_name: message.from.last_name ?? null,
        username: message.from.username ?? null,
        language_code: message.from.language_code ?? null,
    };

    const result = await pool.query<CustomerRecord>(
        `
        INSERT INTO customers (
            channel,
            external_user_id,
            full_name,
            username,
            locale,
            profile,
            updated_at
        )
        VALUES ('telegram', $1, NULLIF($2, ''), $3, $4, $5::jsonb, NOW())
        ON CONFLICT (channel, external_user_id)
        DO UPDATE
        SET
            full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), customers.full_name),
            username = COALESCE(EXCLUDED.username, customers.username),
            locale = COALESCE(EXCLUDED.locale, customers.locale),
            profile = customers.profile || EXCLUDED.profile,
            updated_at = NOW()
        RETURNING id, channel, external_user_id, profile, created_at::text
        `,
        [
            String(message.from.id),
            fullName,
            message.from.username ?? null,
            message.from.language_code ?? null,
            JSON.stringify(profile),
        ],
    );

    return result.rows[0];
}

export async function getOrCreateOpenConversation(
    pool: Pool,
    customerId: string,
    channel: "telegram" | "instagram" | "whatsapp" | "facebook" | "tiktok",
): Promise<ConversationRecord> {
    const existing = await pool.query<ConversationRecord>(
        `
        SELECT id, customer_id, channel, status
        FROM conversations
        WHERE customer_id = $1
          AND channel = $2
          AND status = 'open'
        ORDER BY started_at DESC
        LIMIT 1
        `,
        [customerId, channel],
    );

    if (existing.rowCount && existing.rows[0]) {
        return existing.rows[0];
    }

    const inserted = await pool.query<ConversationRecord>(
        `
        INSERT INTO conversations (customer_id, channel, status, started_at, last_message_at)
        VALUES ($1, $2, 'open', NOW(), NOW())
        RETURNING id, customer_id, channel, status
        `,
        [customerId, channel],
    );

    return inserted.rows[0];
}

export async function saveInboundMessage(
    pool: Pool,
    args: {
        conversationId: string;
        customerId: string;
        channelMessageId: string;
        textContent: string;
        payload: unknown;
    },
): Promise<void> {
    const client = await pool.connect();
    try {
        await withTransaction(client, async () => {
            await client.query(
                `
                INSERT INTO messages (
                    conversation_id,
                    customer_id,
                    direction,
                    channel_message_id,
                    text_content,
                    payload,
                    created_at
                )
                VALUES ($1, $2, 'inbound', $3, $4, $5::jsonb, NOW())
                `,
                [
                    args.conversationId,
                    args.customerId,
                    args.channelMessageId,
                    args.textContent,
                    JSON.stringify(args.payload),
                ],
            );

            await client.query(
                `
                UPDATE conversations
                SET last_message_at = NOW()
                WHERE id = $1
                `,
                [args.conversationId],
            );
        });
    } finally {
        client.release();
    }
}

export async function saveOutboundMessage(
    pool: Pool,
    args: {
        conversationId: string;
        customerId: string;
        channelMessageId: string | null;
        textContent: string;
        payload: unknown;
    },
): Promise<void> {
    const client = await pool.connect();
    try {
        await withTransaction(client, async () => {
            await client.query(
                `
                INSERT INTO messages (
                    conversation_id,
                    customer_id,
                    direction,
                    channel_message_id,
                    text_content,
                    payload,
                    created_at
                )
                VALUES ($1, $2, 'outbound', $3, $4, $5::jsonb, NOW())
                `,
                [
                    args.conversationId,
                    args.customerId,
                    args.channelMessageId,
                    args.textContent,
                    JSON.stringify(args.payload),
                ],
            );

            await client.query(
                `
                UPDATE conversations
                SET last_message_at = NOW()
                WHERE id = $1
                `,
                [args.conversationId],
            );
        });
    } finally {
        client.release();
    }
}

/**
 * Returns the most recent messages in a conversation, oldest-first.
 * Used by the consultant to resolve short follow-up questions against context.
 */
export async function getRecentConversationMessages(
    pool: Pool,
    conversationId: string,
    limit: number,
): Promise<ConversationMessage[]> {
    const result = await pool.query<ConversationMessage>(
        `
        SELECT direction, text_content, created_at::text
        FROM messages
        WHERE conversation_id = $1
        ORDER BY created_at DESC
        LIMIT $2
        `,
        [conversationId, limit],
    );
    return result.rows.reverse();
}
