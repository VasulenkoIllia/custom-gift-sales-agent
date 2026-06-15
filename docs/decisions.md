# Decisions

## Decision: Telegram-first MVP
- Date: 2026-04-16
- Context: Потрібно швидко перевірити продажі через AI-агента в месенджері.
- Decision: Стартувати з Telegram як першого каналу.
- Alternatives considered: Одразу омніканальний запуск (Telegram + Instagram + WhatsApp + Facebook + TikTok).
- Consequences: Швидший запуск і нижчий ризик, але омніканальність переноситься на post-MVP.
- Follow-up actions: Після MVP додати channel adapter layer для масштабування.

## Decision: Єдина БД на PostgreSQL + pgvector
- Date: 2026-04-16
- Context: Потрібні і транзакційні дані, і векторний пошук, і пам'ять користувача.
- Decision: Використовувати PostgreSQL як source of truth + pgvector для embeddings.
- Alternatives considered: Окрема SQL БД + окрема vector DB.
- Consequences: Простіший контур підтримки і синхронізації на MVP.
- Follow-up actions: Профілювати пошук і розглянути виділену vector DB при зростанні навантаження.

## Decision: Сервісна архітектура без надлишкових фреймворків
- Date: 2026-04-16
- Context: На старті потрібна швидка і контрольована реалізація.
- Decision: Node.js + TypeScript + Fastify, чіткі service/adapters шари.
- Alternatives considered: Важка багаторівнева архітектура з великою кількістю абстракцій.
- Consequences: Вищий темп розробки і простіший онбординг.
- Follow-up actions: Поглиблювати модульність поступово за потреби.

## Decision: Безпечна політика генерації відповіді
- Date: 2026-04-16
- Context: Агент не має вигадувати характеристики, ціни і умови.
- Decision: Відповіді тільки на підтверджених даних з каталогу/KB + fallback на уточнення.
- Alternatives considered: "Вільна" генерація з мінімальними обмеженнями.
- Consequences: Вища точність, менше ризику помилкових продажів.
- Follow-up actions: Додати автоматичні тести на factuality.

## Decision: CRM інтеграція через подієвий adapter з idempotency
- Date: 2026-04-16
- Context: Потрібна надійна передача lead/order без дублювань.
- Decision: Події `lead.created_or_updated`, `order.draft_created`, `order.confirmed` + idempotency keys + retry.
- Alternatives considered: Прямі синхронні виклики без журналу подій.
- Consequences: Менше дублювань та втрачених замовлень.
- Follow-up actions: Додати alerting на критичні помилки інтеграції.

## Decision: CRM провайдер для MVP — KeyCRM
- Date: 2026-04-16
- Context: Потрібен реальний API для товарів, замовлень і подальшого handoff з месенджера.
- Decision: Використовувати KeyCRM OpenAPI (`https://openapi.keycrm.app/v1`) для MVP.
- Alternatives considered: Відкласти інтеграцію до post-MVP або почати з моків.
- Consequences: Можемо тестувати на реальних товарах і даних уже на ранніх етапах.
- Follow-up actions: Описати mapping полів KeyCRM <-> внутрішня модель lead/order.

## Decision: Follow-up cadence для MVP
- Date: 2026-04-16
- Context: Потрібна чітка і проста логіка догріву без перевантаження клієнта.
- Decision: Два follow-up, якщо замовлення не оформлено: через 1 день і через 7 днів.
- Alternatives considered: Частіші нагадування або лише одне нагадування.
- Consequences: Проста керована стратегія для тестування конверсії в MVP.
- Follow-up actions: Додати job-обробник над таблицею `followups`.

## Decision: Момент створення замовлення в CRM
- Date: 2026-04-16
- Context: Потрібно уникнути створення зайвих/помилкових замовлень у CRM.
- Decision: Створювати замовлення в KeyCRM тільки після явного підтвердження клієнтом.
- Alternatives considered: Створювати order draft раніше в ході діалогу.
- Consequences: Менше шуму в CRM, вищий сигнал якості по замовленнях.
- Follow-up actions: Уточнити текст/правило \"явного підтвердження\" в sales flow.

## Decision: Slot-дані (occasion/recipient/urgency) у JSONB preferences, без нових колонок
- Date: 2026-05-09
- Context: Потрібно зберігати occasion, recipient, urgency для персоналізації follow-up і system prompt без витрат на міграцію схеми.
- Decision: Зберігати extracted slots у вже наявному `customer_memory.preferences` JSONB під ключами `occasion`, `recipient`, `urgency`. Вилучення через regex-мапи в `extractSlots()` у `ai-store.ts`.
- Alternatives considered: Нові SQL колонки в `customer_memory` (Phase C плану).
- Consequences: Нульова міграція, але без жорсткої типізації та індексів. Достатньо для MVP.
- Follow-up actions: Phase C — перенести у власні колонки + OpenAI Structured Outputs замість regex.

## Decision: Негативні залишки → "немає в наявності" в catalog_chunks
- Date: 2026-05-09
- Context: KeyCRM повертає від'ємні кількості (наприклад `-1.000`) для недоступних варіантів. LLM трактував це як наявність, що давало 7.7% hallucination rate на eval.
- Decision: Функція `offerStockLabel()` в `keycrm-sync.ts` та `rebuild-chunks.ts` конвертує будь-яке `qty <= 0` → `"немає в наявності"`, `qty > 0` → `"в наявності: N шт."`, `null` → `"залишок невідомо"`. Продуктовий chunk показує залишки по варіантах (`Залишки по варіантах: White: в наявності: 25 шт.; Black: немає в наявності`).
- Alternatives considered: Пост-фільтрація в промпті; залишити raw values.
- Consequences: Eval hallucination rate dropped 7.7% → 0.0% (39/39 passed).
- Follow-up actions: Моніторити при оновленнях KeyCRM sync; при зміні логіки запускати `npm run chunks:rebuild`.

## Decision: 8-стадійна sales state machine з пріоритетом і assistantText detection
- Date: 2026-05-09
- Context: Оригінальна `inferSalesStage()` мала 4 стани (new/discovery/considering/confirmed) і не могла підтримувати stage-aware system prompt.
- Decision: Розширено до 8 станів (`new → discovery → qualification → presenting → objection → closing → confirmed / lost`) в `inferSalesStageFromTurn()`. Прогрес однонаправлений (через `STAGE_PRIORITY` map, переходи тільки вперед за числовим пріоритетом). `presenting` детектується по тексту відповіді асистента (патерн ціни/назви), не тільки по запиту.
- Alternatives considered: Залишити 4 стани; LLM-based stage classification.
- Consequences: System prompt тепер варіює поведінку за стадією. Обратна сумісність збережена — старі stage values не ламають логіку.
- Follow-up actions: Phase D — LLM-based classification для складних переходів; Guardian Agent перевірка перед відправкою.

## Decision: Розділення угод у межах одного чату через sales_thread (Post-MVP)
- Date: 2026-04-17
- Context: В одному чаті користувач може вести кілька консультацій і замовлень. Використання лише загальної історії збільшує ризик змішування контекстів і неповних замовлень.
- Decision: Додати окрему сутність `sales_thread` як робочий контекст угоди та прив'язати до неї `messages`, `followups`, `crm_orders`.
- Alternatives considered: Залишити тільки глобальну історію `conversation/messages` без додаткового контекстного шару.
- Consequences: Менше помилок при підтвердженні замовлення, точніша аналітика по воронці, контрольований перехід між кількома угодами в одному чаті.
- Follow-up actions: Після MVP додати міграції `sales_threads` + `sales_thread_id` FK у ключові таблиці та перевести routing/CRM-handoff на активний `sales_thread`.

## Decision: Видалення "беру" з ключових слів підтвердження замовлення
- Date: 2026-05-10
- Context: "беру" — сигнал наміру купити (closing), але не явне підтвердження. Його наявність у `DEFAULT_CONFIRM_KEYWORDS` викликала передчасне створення замовлення в CRM після фраз типу "беру товар".
- Decision: Видалено "беру" з `DEFAULT_CONFIRM_KEYWORDS` у `order-service.ts`. "беру" залишається як сигнал переходу в стан `closing` (через `CLOSING_SIGNALS` у `ai-store.ts`), але не тригерить `isOrderConfirmationMessage()`.
- Alternatives considered: Залишити "беру" і перевіряти його тільки в комбінації з іншими сигналами.
- Consequences: Нульові фальш-позитиви для "беру" / "беру товар". Клієнт має написати явне підтвердження ("підтверджую замовлення", "оформляємо" тощо).
- Follow-up actions: Зафіксовано у TC-008 у `eval-conversations.ts`.

## Decision: Кирилична regex — замінити `\b` на Unicode property lookaround
- Date: 2026-05-10
- Context: JavaScript `\b` (навіть з флагом `/u`) — ASCII-only: `\w = [A-Za-z0-9_]`. Кириличні символи завжди "non-word", тому `\b` між двома кириличними словами не спрацьовує ніколи. Це спричиняло false negatives і false positives у детекції інтентів на українських фразах.
- Decision: Замінити всі `\b` у `ORDER_INTENT_PATTERN`, `AFFIRMATION_PATTERN`, `NEGATION_PATTERN` (у `order-service.ts`) на Unicode property lookaround `(?<!\p{L})...(?!\p{L})` з флагом `/iu`. Підхід правильно розмежовує кириличні токени без залежності від ASCII `\w`.
- Alternatives considered: Власні символьні класи `[а-яА-ЯіїєІЇЄ]`; залишити без змін і покладатися на пробіли.
- Consequences: Всі 28 unit-тестів (`npm run eval:unit`) та 8 conversation-тестів (`npm run eval:conversations`) проходять.
- Follow-up actions: Застосовувати той самий підхід до будь-яких нових Cyrillic regex у проекті.

## Decision: Аффірмація обов'язкова для intent-path підтвердження замовлення
- Date: 2026-05-10
- Context: Після виправлення `\b` → Unicode lookaround `купити` у `ORDER_INTENT_PATTERN` почало матчити "Хочу купити подарунок" (загальний намір), що тригерило `isOrderConfirmationMessage() = true` для нейтральних shopping-фраз.
- Decision: В `isOrderConfirmationMessage()` для intent-path (перевірка `ORDER_INTENT_PATTERN`) аффірмація (`AFFIRMATION_PATTERN`) стала **завжди обов'язковою**, а не тільки коли є знак питання. "хочу" прибрано з `AFFIRMATION_PATTERN` — воно надто загальне. Достатньо: "так", "підтверджую", "готовий/а", "давайте", "погнали", "ок", "окей".
- Alternatives considered: Вузити `ORDER_INTENT_PATTERN` до суто explicit дієслів; перевіряти кількість слів у повідомленні.
- Consequences: "хочу купити подарунок" → false; "так, оформляємо" → true. Zero false positives при нейтральному shopping intent.
- Follow-up actions: Зафіксовано у `test("isOrderConfirmationMessage: intent pattern requires affirmation")` у `eval-unit.ts`.

## Decision: Vector distance threshold для RAG (VECTOR_DISTANCE_THRESHOLD)
- Date: 2026-05-10
- Context: Без порогу схожості векторний пошук повертав каталогові chunks з низькою релевантністю (схожість < 0.55), що давало контекст не по темі і спричиняло hallucinations або "розмиті" відповіді.
- Decision: Додати фільтр `(ce.embedding <=> $1::vector) < threshold` у `searchCatalogByEmbedding()`. Значення за замовчуванням: `VECTOR_DISTANCE_THRESHOLD=0.45` (cosine distance, менше = схожіше). Конфігурується через env-змінну.
- Alternatives considered: Post-retrieval reranking; фіксований мінімальний score; без фільтру.
- Consequences: Більш релевантні results за рахунок потенційно нижчого recall. При нульових results — fallback на keyword search.
- Follow-up actions: Дослідити оптимальний поріг після аналізу реальних запитів (потенційно 0.4–0.5).

## Decision: Бюджетний фільтр у RAG із 20% буфером
- Date: 2026-05-10
- Context: Без бюджетного фільтру RAG повертав товари дорожчі за вказаний бюджет, що примушувало LLM самостійно фільтрувати або пропонувати непридатні варіанти.
- Decision: `searchCatalogByEmbedding()` та `searchCatalogByKeyword()` приймають `budgetMax`. SQL умова: `p.price <= budgetMax * 1.2` (20% буфер дає простір для "майже в бюджеті" пропозицій). Якщо results = 0 — fallback retry без фільтру.
- Alternatives considered: Фільтрація в post-processing у JavaScript; фіксований абсолютний буфер (100 грн).
- Consequences: RAG context більш бюджето-доцільний. Fallback гарантує, що користувач завжди отримає варіанти навіть при жорсткому бюджеті.
- Follow-up actions: Відслідковувати, як часто спрацьовує fallback; можливо збільшити буфер до 30%.

## Decision: Синхронне вилучення слотів перед LLM retrieval
- Date: 2026-05-10
- Context: `extractSlots()` і `extractBudget()` раніше викликались після LLM генерації (для збереження в пам'ять). Це означало, що бюджет і нагода, вказані в поточному повідомленні, не використовувались у поточному RAG-запиті, а тільки в наступному.
- Decision: `extractSlots(userText)` і `extractBudget(userText)` викликаються синхронно в `generateReply()` ПЕРЕД `retrieveCatalogContext()`. Результат `immediateBudget.max` використовується як `effectiveBudgetMax` для поточного RAG-запиту. В пам'ять зберігається стара логіка через `upsertCustomerMemoryTurn()`.
- Alternatives considered: Окремий LLM-call для вилучення слотів; повністю regex-based extraction без LLM.
- Consequences: Бюджет і нагода з поточного повідомлення одразу впливають на вибірку товарів. Без додаткової latency (sync regex, не LLM).
- Follow-up actions: Phase D — LLM Structured Outputs для складніших витягів.

## Decision: Трекінг consecutive_objections у preferences
- Date: 2026-05-10
- Context: Не було автоматичного механізму виявлення, коли клієнт неодноразово заперечує — що є сигналом для human escalation або зміни стратегії.
- Decision: У `upsertCustomerMemoryTurn()` лічильник `consecutive_objections` зберігається у `preferences` JSONB. Зростає на +1 при кожному `objection` стані, скидається до 0 на будь-якому іншому стані. При досягненні `ESCALATION_OBJECTION_THRESHOLD` (дефолт: 2) у system prompt додається `[ESCALATION_ALERT]` і `needsEscalation: true` повертається з `generateReply()`.
- Alternatives considered: Рахувати кількість повідомлень; виявляти через LLM-класифікатор.
- Consequences: Авто-визначення потреби в ескалації. Логується у `console.warn` та у `messages.payload.ai.needs_escalation`.
- Follow-up actions: Phase D.D3 — реальний handoff (notify manager + silent mode).

## Decision: last_presented_product_name замість latest_request у follow-up
- Date: 2026-05-10
- Context: Follow-up worker використовував `memory.preferences.latest_request` (останнє повідомлення клієнта) для персоналізації шаблону. Це давало текст типу "беру" або "покажи" замість назви товару.
- Decision: У `upsertCustomerMemoryTurn()` при наявності `lastPresentedProductIds` виконується SQL lookup `SELECT name FROM products WHERE keycrm_product_id = $1` і результат зберігається у `preferences.last_presented_product_name`. Follow-up worker використовує `last_presented_product_name` замість `latest_request`.
- Alternatives considered: Зберігати назву товару в окрему колонку; брати з тексту outbound повідомлення.
- Consequences: Follow-up шаблони містять реальну назву товару ("Ви розглядали Набір свічок...").
- Follow-up actions: Моніторити якість lookup при зміні `keycrm_product_id`.

## Decision: In-memory per-chat rate limiter
- Date: 2026-05-10
- Context: Telegram дозволяє клієнту надсилати повідомлення дуже швидко. Швидкі дублікати викликали кілька паралельних LLM requests для одного чату, що давало непередбачувані відповіді і зайві витрати.
- Decision: `Map<number, number>` (`chatLastProcessed`) у `index.ts` трекує timestamp останнього обробленого повідомлення per `chat.id`. Якщо інтервал менший за `CHAT_RATE_LIMIT_MS` (дефолт: 1500 мс) — повідомлення відкидається без відповіді.
- Alternatives considered: Redis-based rate limiter (overkill для MVP); queue per chat.
- Consequences: Захист від швидких дублікатів. Скидається при рестарті процесу — нормально для MVP.
- Follow-up actions: Перевести на Redis при горизонтальному масштабуванні.

## Decision: DB connection pool конфігурація (max, idle, connection timeouts)
- Date: 2026-05-10
- Context: `createDbPoolFromEnv()` створював pool з дефолтами `pg` (max: 10 без явного ліміту, без timeout). При пікових навантаженнях або зависанні запитів — connection leak.
- Decision: Явні ліміти: `max: DB_POOL_MAX || 10`, `idleTimeoutMillis: 30_000`, `connectionTimeoutMillis: 5_000`. SSL конфігурується через `sslmode` URL param: `require` → `{rejectUnauthorized:false}`, `disable` → `false`, `prefer` → `undefined`.
- Alternatives considered: ORM з вбудованим pool management; connection per request.
- Consequences: Передбачувана поведінка при навантаженні. SSL режим конфігурується без зміни коду.
- Follow-up actions: Прокинути DB_POOL_MAX у prod env.

## Decision: HNSW + GIN trigram indexes для product search
- Date: 2026-05-10
- Context: Без HNSW index кожен векторний пошук робив full table scan по `catalog_embeddings`. Без GIN index `ILIKE` запити в keyword search також були full scans.
- Decision: Міграція `004_indexes.sql`: HNSW index (`m=16, ef_construction=64`) для `catalog_embeddings.embedding`. GIN trigram indexes (`pg_trgm`) для `catalog_chunks.content`, `products.name`, `products.search_text`. Partial index на `messages` для `payload->'ai'->'presented_product_ids'` де `direction='outbound'`.
- Alternatives considered: IVFFlat замість HNSW (гірший recall); Elasticsearch для full-text search.
- Consequences: ANN пошук замість точного векторного (negligible accuracy loss, ~10-100x speedup при scale). ILIKE queries ефективні з тригрем.
- Follow-up actions: Запустити `npm run db:migrate` для застосування міграції.

## Decision: node:test built-in для автоматичного тестування чистих функцій
- Date: 2026-05-10
- Context: Потрібна автоматична верифікація ключових pure-function алгоритмів (order detection, slot extraction, stage machine) без залежностей від DB або API keys.
- Decision: Два скрипти: `eval-unit.ts` (28 unit tests, `node:test` built-in, `--test` flag) і `eval-conversations.ts` (8 conversation stage tests). Запуск: `npm run eval:unit` і `npm run eval:conversations`. Без зовнішніх test framework.
- Alternatives considered: Jest / Vitest (зайві deps для MVP); ручне тестування.
- Consequences: 36 автоматичних тестів без DB/API. CI-ready при потребі. 0 зовнішніх залежностей для тестів.
- Follow-up actions: Додати до CI pipeline при налаштуванні GitHub Actions.
