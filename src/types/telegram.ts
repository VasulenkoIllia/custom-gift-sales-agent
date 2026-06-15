export interface TelegramUser {
    id: number;
    is_bot: boolean;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
}

export interface TelegramChat {
    id: number;
    type: string;
    username?: string;
    first_name?: string;
    last_name?: string;
}

export interface TelegramMessage {
    message_id: number;
    date: number;
    chat: TelegramChat;
    from?: TelegramUser;
    text?: string;
}

export interface TelegramUpdate {
    update_id: number;
    message?: TelegramMessage;
    edited_message?: TelegramMessage;
}

export interface TelegramSendMessageResponse {
    ok: boolean;
    result?: TelegramMessage;
    description?: string;
}

export interface TelegramGetUpdatesParams {
    offset?: number;
    limit?: number;
    timeout?: number;
    allowed_updates?: string[];
}

export interface TelegramGetUpdatesResponse {
    ok: boolean;
    result: TelegramUpdate[];
    description?: string;
}
