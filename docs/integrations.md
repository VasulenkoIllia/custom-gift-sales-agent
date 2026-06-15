# Integrations

## Integration: Telegram Bot API
- Purpose: Основний канал MVP для консультацій та продажу.
- Auth: Bot token.
- Endpoints / Events:
  - webhook receive updates (`POST /webhooks/telegram`)
  - local polling bridge (`getUpdates` -> local webhook) для dev середовища без публічного URL
  - sendMessage / editMessage / callback handling
- Retry policy: Telegram delivery retries на рівні webhook endpoint + внутрішні retry для outbound.
- Timeout policy: 3-5s на зовнішні запити, далі retry.
- Rate limits: Враховувати platform limits, додати чергу на outbound повідомлення.
- Webhook signature / validation: `secret_token` для webhook валідації.
- Failure handling: Логувати помилки, safe retry, dead-letter для постійних збоїв.
- Idempotency notes: deduplicate inbound events по update_id.
- Env vars:
  - `TELEGRAM_BOT_TOKEN`
  - `TELEGRAM_WEBHOOK_SECRET`
  - `TELEGRAM_WEBHOOK_URL`
  - `TELEGRAM_API_BASE_URL`
  - `TELEGRAM_TIMEOUT_MS`
  - `TELEGRAM_LOCAL_WEBHOOK_URL`
  - `TELEGRAM_POLL_TIMEOUT_SEC`
  - `TELEGRAM_POLL_LIMIT`
  - `TELEGRAM_POLL_IDLE_MS`
  - `TELEGRAM_POLL_REQUEST_TIMEOUT_MS`
- Notes: Telegram є єдиним каналом для MVP.

## Integration: KeyCRM API
- Purpose: Джерело товарів для консультації + передача лідів/замовлень у CRM.
- Auth: `Authorization: Bearer <API_KEY>`.
- Endpoints / Events:
  - `GET /products` — список товарів (пагінація).
  - `GET /offers` — варіанти товарів (SKU/ціни/зв'язок із товаром).
  - `GET /offers/stocks` — залишки.
  - `GET /products/categories` — категорії.
  - `GET /order`, `POST /order` — читання/створення замовлень.
- Retry policy: exponential backoff (до 5 спроб) для 429/5xx/timeout.
- Timeout policy: 5-10s + retry.
- Rate limits: до 60 запитів/хвилину на API-ключ з однієї IP.
- Webhook signature / validation: для вхідних webhooks визначається окремо, для pull-запитів не застосовується.
- Failure handling: integration event log + dead-letter queue для постійних збоїв.
- Idempotency notes: dedupe на стороні нашого сервісу для `lead/order` синхронізацій.
- Env vars:
  - `KEYCRM_BASE_URL` (default `https://openapi.keycrm.app/v1`)
  - `KEYCRM_API_TOKEN`
  - `KEYCRM_TIMEOUT_MS`
  - `KEYCRM_ORDER_SOURCE_ID`
- Notes: всі дати в API повертаються в UTC.

### MVP business rules (узгоджено на 2026-04-16)
- Після підтвердження замовлення клієнтом створюємо нове замовлення в KeyCRM.
- Якщо замовлення не оформлено: follow-up через 1 день і через 7 днів.
- У консультації дозволено використовувати весь доступний набір полів товару/варіанту/залишку.
- Дедуп webhook подій виконується через таблицю `telegram_updates` по `update_id`.

## Integration: OpenAI API
- Purpose: Генерація консультаційної відповіді та embeddings для `catalog_chunks`.
- Auth: `Authorization: Bearer <OPENAI_API_KEY>`.
- Endpoints / Events:
  - `POST /chat/completions` — відповідь AI агента у діалозі
  - `POST /embeddings` — векторизація консультаційних chunk-ів каталогу
- Retry policy: для `embeddings` джоби повторний запуск для failed chunk-ів; для chat у runtime fallback на keyword+template відповідь.
- Timeout policy: `OPENAI_TIMEOUT_MS` (default 20000 ms).
- Rate limits: batch processing для embeddings (`EMBEDDING_BATCH_SIZE`) + пауза між викликами (`EMBEDDING_SLEEP_MS`).
- Failure handling: якщо LLM недоступний, використовуємо fallback відповідь без блокування sales flow.
- Idempotency notes: embeddings upsert по `catalog_embeddings.chunk_id`.
- Env vars:
  - `OPENAI_API_KEY`
  - `OPENAI_BASE_URL`
  - `OPENAI_CHAT_MODEL`
  - `OPENAI_EMBEDDING_MODEL`
  - `OPENAI_TIMEOUT_MS`
  - `AI_CONTEXT_TOP_K`
  - `AI_AGENT_LANGUAGE`
  - `AI_AGENT_TONE`
  - `AI_AGENT_SYSTEM_PROMPT_APPEND`
  - `EMBEDDING_BATCH_SIZE`
  - `EMBEDDING_MAX_ITEMS`
  - `EMBEDDING_SLEEP_MS`
- Notes: без `OPENAI_API_KEY` агент працює у fallback режимі (keyword retrieval + template reply).

## Integration: Catalog Source (CSV / Google Sheets / API)
- Purpose: Наповнення та оновлення SKU.
- Auth: Service account / API key / none (для локального CSV).
- Endpoints / Events: pull feed, validate, normalize, upsert.
- Retry policy: retry pull/import з backoff.
- Timeout policy: 15-30s залежно від джерела.
- Rate limits: batching і chunk import.
- Webhook signature / validation: не застосовується (для pull), або за джерелом.
- Failure handling: import report + часткові ретраї.
- Idempotency notes: upsert по stable external SKU id.
- Env vars:
  - `CATALOG_SOURCE_TYPE`
  - `CATALOG_SOURCE_URL`
  - `CATALOG_IMPORT_CRON`
- Notes: після імпорту запускається embedding refresh.

## Planned Integrations (Post-MVP)
- Instagram Messaging API (Meta)
- WhatsApp Cloud API (Meta)
- Facebook Messenger Platform (Meta)
- TikTok channel (після підтвердження доступного messaging use-case/API)
