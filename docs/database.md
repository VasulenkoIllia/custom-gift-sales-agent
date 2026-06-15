# Database design for консультації AI агента

## Принцип
Щоб агент добре консультував, дані з CRM зберігаються у двох формах:
1. `raw` (аудит, дебаг, повне джерело правди)
2. `normalized + consulting chunks` (швидкий бізнес-пошук і RAG)

## Основні таблиці
- `products_raw` — сирий JSON товару з KeyCRM
- `products` — нормалізовані поля товару (назва, ціна, SKU, залишок)
- `product_offers` — варіанти товарів (властивості, ціни, SKU)
- `offer_stocks` — поточні залишки по варіантах
- `product_categories` — категорії товарів
- `catalog_chunks` — підготовлений текст для консультації
- `catalog_embeddings` — вектори для semantic search (RAG)

## Пам'ять клієнта і діалоги
- `customers`
- `conversations`
- `messages`
- `customer_memory`

## Продаж і follow-up
- `followups` (MVP: `day_1`, `day_7`)
- `crm_orders` (створення order після підтвердження клієнта)
- `integration_events` (ідемпотентність/ретраї)
- `sync_runs` (аудит синхронізації)

## Post-MVP таблиці для розділення угод у одному чаті
- `sales_threads`
  - ключі: `id`, `customer_id`, `conversation_id`
  - статуси: `open`, `awaiting_confirmation`, `won`, `lost`, `canceled`
  - робочі поля: `selected_product_id`, `selected_offer_id`, `selected_snapshot`, `last_activity_at`, `started_at`, `closed_at`
- `messages.sales_thread_id` (nullable FK)
  - дозволяє прив'язати кожну репліку до конкретної угоди
- `crm_orders.sales_thread_id` (nullable FK)
  - гарантує, що order має джерело в конкретному `sales_thread`
- `followups.sales_thread_id` (nullable FK)
  - нагадування по конкретній угоді, а не по всьому діалогу

Міграційний підхід:
1. Додати `sales_threads` і nullable `sales_thread_id` поля в `messages`, `crm_orders`, `followups`.
2. На етапі backfill проставити `sales_thread_id` для активних діалогів евристично (по часу та продукту).
3. Поступово перевести runtime на роботу через активний `sales_thread`.

## Потік sync
1. `keycrm:sync` читає KeyCRM `products`, `offers`, `offers/stocks`, `products/categories`
2. Робить upsert у raw і normalized таблиці
3. Soft-archive для відсутніх товарів/оферів
4. Перегенеровує `catalog_chunks` для консультацій
5. `embeddings:catalog` оновлює `catalog_embeddings` для нових/змінених chunk-ів

## Чому це працює для продажів
- Агент має структуровану базу для фактів (ціна/наявність/SKU)
- Є повний raw payload для перевірки і нестандартних питань
- Є консультаційний текст і база для embeddings
- Є персональна пам'ять клієнта + історія діалогу
