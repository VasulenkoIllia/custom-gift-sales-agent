# Sales Agent: Повний план реалізації, промпти та тестування

> **Дата:** 2026-05-09  
> **Статус:** MVP реалізований, цей документ — план для Sales Brain upgrade.
> **Дослідження:** охоплює кращі практики 2024 та 2025-2026 (web search по актуальних джерелах).

---

## 0. Що реально нового у 2025-2026 (vs 2024)

> Цей розділ — синтез web-дослідження по поточних (2025-2026) джерелах. Тут лише те, що **справді змінилось**, а не повтор старих підходів.

### 0.1 Context Engineering замінив Prompt Engineering

**Gartner, липень 2025:** "context engineering is in, prompt engineering is out."

Різниця принципова:
- **2024:** "Як сформулювати system prompt?"
- **2025-2026:** "Яку повну множину інформації (стан юзера, поведінкові сигнали, пам'ять, динамічні дані) треба подати в кожен LLM call?"

Це означає: пріоритет зміщується від тексту промпту → до **pipeline що збирає контекст** перед кожним LLM викликом. Для вашого бота: occasion, recipient, browsing history, rejected products, current stock — все це має потрапляти в контекст до генерації, не після.

Anthropic також опублікував "Effective Context Engineering for AI Agents" (2025) — підтверджує той самий напрям.

### 0.2 Model Routing (економічно доступний у 2025-2026)

**Нова стандартна практика:** різні моделі для різних типів turns.

| Turn type | Модель | Причина |
|---|---|---|
| Привітання, FAQ, базова інфо | `gpt-4o-mini` / `claude-haiku` | Дешево, швидко, достатньо |
| Показ товарів, кваліфікація | `gpt-4o-mini` | Достатньо для структурованого контенту |
| Обробка заперечень, складні питання | `gpt-4o` / `claude-sonnet` | Потрібна більша якість reasoning |
| High-value closing | `gpt-4o` / `claude-opus` | Найкраще розуміння контексту |

У 2024 це було дорого. У 2025-2026 — стандарт. Дає **30-50% економії** при збереженні якості там де важливо.

Для вашого коду: додати поле `complexity` до `generateReply()` і роутити між двома клієнтами.

### 0.3 Mem0 — бібліотека для persistent memory

**Mem0** (відкритий код, $24M Series A у 2025) вирішує саме вашу задачу — persistent customer memory:
- Підтримує **pgvector як backend** — ваша база вже готова
- API: `add()` після кожного turn, `search()` перед генерацією
- Заявляють **80% скорочення токенів** завдяки компресії пам'яті
- **91% зниження latency** порівняно з передачею повної history

Практично: замість вашого поточного `customer_memory` з одним `summary TEXT` — структурована пам'ять з векторним пошуком релевантних спогадів. GitHub: `mem0ai/mem0`.

**Для MVP:** можна реалізувати аналогічний підхід вручну без залежності від бібліотеки — `memory_items` таблиця з embeddings, замість одного summary.

### 0.4 Guardian Agent Pattern (новий у 2025-2026)

**Проблема:** мультиагентні системи дрейфують — агент вигадує факти, виходить за scope, порушує compliance.

**Guardian Agent** — легкий validation layer що перевіряє відповідь агента ПЕРЕД відправкою:
- Чи немає вигаданих цін/фактів?
- Чи не виходить за дозволений scope?
- Чи відповідає тону і правилам?

Для вашого бота — спрощений варіант: **post-generation check** перед `sendTelegramMessage()`:
```typescript
async function validateBeforeSend(reply: string, catalogContext: string): Promise<boolean> {
    // Перевірити що числа у відповіді є в catalogContext
    // Перевірити що не вживаються заборонені фрази
    // Якщо fail → fallback відповідь або escalation
}
```

### 0.5 Behavioral State — проактивне залучення

**Ключовий інсайт 2025-2026:** бот що чекає запиту → бот що реагує на поведінкові сигнали.

Для Telegram gift shop практично:
- Якщо клієнт написав → переглянув → пропав: **follow-up через 5 хвилин** (не 1 день!)
- Repeat visit (повернувся після перерви > 1 год): відкривати з "Продовжуємо пошук?"
- 2+ заперечення поспіль: автоматично запропонувати human handoff

Ці тригери мають бути **окремими правилами**, не частиною LLM промпту.

### 0.6 Structured Outputs для CRM writes

**OpenAI Structured Outputs (2024-2025) + Function Calling** — стандарт для записів у базу.

Замість парсингу тексту відповіді LLM → просити модель повернути JSON з витягнутими слотами:

```typescript
// Після генерації відповіді — окремий extraction call
const extracted = await openAiClient.createStructuredOutput({
    schema: {
        occasion: "string | null",
        recipient: "string | null", 
        budget_max: "number | null",
        rejected_product_ids: "number[]",
        sales_stage: "new|discovery|qualification|presenting|objection|closing|confirmed|lost",
        urgency: "string | null"
    },
    input: userText + "\n\nAgent reply: " + replyText
});
// Зберігаємо в customer_memory — без regex парсингу
```

Надійніше ніж regex, не потребує окремого LLM call якщо використати один prompt з dual output.

### 0.7 Нові метрики та бенчмарки (2025-2026)

**Актуальні цифри (з верифікованих джерел):**
- AI chatbot конверсія: **+23%** (Glassix study, верифіковано)
- Відновлення покинутих кошиків: **35%** (AI-assisted proactive chat)
- Швидкість покупки: **47% швидше** при взаємодії з AI
- Персоналізована рекомендація → конверсія в **2-3x вища** vs generic

**7 KPI що рахують у 2025-2026** (замість "containment rate"):
1. Chat-to-purchase conversion rate
2. AOV (average order value) чат-attributed покупок
3. Cart recovery rate
4. Escalation rate (10-20% нормально; <5% — підозріло)
5. Time to first meaningful response (< 2 сек routine, < 4 сек complex)
6. Repeat engagement rate (юзери що повертаються)
7. **Recommendation acceptance rate** — найсильніший сигнал якості рекомендацій

### 0.8 Hybrid RAG — мінімальний стандарт 2025

Чиста векторна пошукова система — **вже застарілий підхід**. Мінімум:
- **Semantic search** (pgvector) — для intent-based запитів
- **Keyword search** — для точних запитів ("артикул 1234", "синя 5x7 рамка")
- **Reranking** — злиття результатів перед подачею в LLM

Ваш поточний код вже робить vector + keyword fallback. Наступний крок — **паралельний запуск обох** і reranking замість "якщо вектор не знайшов — тоді keyword".

### 0.9 Що поки НЕ варто впроваджувати (перезрілі тренди)

- **Multimodal RAG** (фото → пошук) — early adopters тільки, не production-ready для MVP
- **Graph RAG** — корисно, але складно: для 2-го раунду після стабілізації KB
- **MemMachine** (arxiv, квітень 2026) — академічна стадія, не готово до production

---

---

## 1. Аудит поточного стану

### Що вже є

| Компонент | Стан | Якість |
|---|---|---|
| Telegram webhook + polling | ✅ Є | Добре |
| KeyCRM sync (products, offers, stocks) | ✅ Є | Добре |
| RAG (vector + keyword fallback) | ✅ Є | Базово |
| Customer memory (summary, budget, objections, stage) | ✅ Є | Базово |
| Order creation в CRM | ✅ Є | Добре |
| Follow-up scheduling (day_1, day_7) | ✅ Є | Основа є, шаблонів немає |
| System prompt | ✅ Є | Базовий, 10 правил |
| Knowledge base (delivery, returns, FAQ) | ❌ Немає | Критичний gap |
| Sales stages (state machine) | ⚠️ Часткове | Тільки 4 стани |
| Objection handling | ⚠️ Часткове | Детектор є, логіки немає |
| Occasion/recipient extraction | ❌ Немає | Критичний gap |
| A/B тестування | ❌ Немає | |
| Factuality eval | ❌ Немає | |
| Follow-up message templates | ❌ Немає | |
| Upsell/cross-sell логіка | ❌ Немає | |

### Критичні проблеми

1. **System prompt не знає про sales stage** — LLM отримує поточний stage у `SALES_STAGE`, але в промпті немає інструкцій що робити на кожному etapі.
2. **Memory не зберігає нагоду і одержувача** — найважливіші дані для підбору подарунку ніде не зберігаються.
3. **Knowledge base відсутня** — клієнт запитує про доставку, повернення, оплату — агент не має даних.
4. **Follow-up повідомлення порожні** — функція `scheduleDefaultFollowups` планує follow-up, але шаблону немає.

---

## 2. Архітектура Sales Brain

### Повний flow

```
Клієнт пише повідомлення
         │
         ▼
1. DEDUP  (telegram_updates по update_id)
         │
         ▼
2. CUSTOMER UPSERT  (customers)
         │
         ▼
3. CONVERSATION OPEN  (conversations)
         │
         ▼
4. SAVE INBOUND  (messages)
         │
         ▼
5. LOAD CONTEXT
   ├── customer_memory (stage, budget, occasion, recipient, objections, summary)
   ├── messages (last 10, scoped to current consultation)
   └── sales_threads (post-MVP)
         │
         ▼
6. INTENT CLASSIFICATION
   ├── order_confirmation? → OrderService → CRM → відповідь
   ├── objection? → objection handler path
   ├── generic_consultation? → ask clarifying questions
   └── product_request? → RAG path
         │
         ▼
7. RAG RETRIEVAL
   ├── vector search (catalog_embeddings)
   ├── keyword fallback (catalog_chunks)
   └── knowledge_items (delivery, FAQ, occasion guides)
         │
         ▼
8. STAGE INFERENCE (інтегрований, бачить весь контекст)
         │
         ▼
9. LLM GENERATION (stage-aware system prompt + full context)
         │
         ▼
10. SLOT EXTRACTION (occasion, recipient, urgency з відповіді)
         │
         ▼
11. MEMORY UPDATE (upsertCustomerMemoryTurn + extracted slots)
         │
         ▼
12. SAVE OUTBOUND + SCHEDULE FOLLOWUP
```

---

## 3. Sales State Machine (8 станів)

### Стани та переходи

```
new
 └──► discovery        (перший запит, немає criteria)
       └──► qualification   (бюджет або нагода відомі)
             └──► presenting    (показані товари)
                   ├──► objection    (клієнт заперечив)
                   │     ├──► presenting (повторна пропозиція)
                   │     └──► lost       (клієнт відмовився/замовк)
                   └──► closing     (клієнт готовий купити)
                         └──► confirmed  (явне підтвердження → CRM order)
                               └──► new  (нова консультація після замовлення)
```

### Сигнали для переходу між станами

```typescript
// Розширити inferSalesStage() в ai-store.ts

const STAGE_SIGNALS = {
  // new → discovery
  discovery: [
    'підбери', 'порадь', 'що краще', 'шукаю подарунок', 'допоможіть обрати',
    'що порадите', 'хочу купити', 'потрібен подарунок', 'цікавить', 'консультацію'
  ],

  // discovery → qualification
  qualification: [
    // бюджет (вже є parseBudget())
    // нагода
    'день народження', 'весілля', 'річниця', 'корпоратив', 'новий рік',
    'валентин', '8 березня', '23 лютого', 'випускний', 'народження дитини',
    // одержувач
    'для мами', 'для тата', 'для дружини', 'для чоловіка', 'для дівчини',
    'для хлопця', 'для дитини', 'для колеги', 'для керівника', 'для подруги',
    'для друга', 'для бабусі', 'для дідуся'
  ],

  // presenting
  presenting: [
    // LLM показав товари — детектується по outbound повідомленню
    // Contains product_id or price in outbound
  ],

  // presenting → objection
  objection: [
    'дорого', 'занадто дорого', 'ціна велика', 'дорогувато',
    'не підходить', 'не те', 'не підійшло', 'інше', 'щось інше',
    'треба подумати', 'напишу пізніше', 'подумаю', 'не впевнений',
    'нема в наявності', 'немає', 'не знаю', 'може є дешевше'
  ],

  // presenting/objection → closing
  closing: [
    'хочу цей', 'беру', 'беремо', 'як оформити', 'хочу замовити',
    'оформіть', 'підходить', 'відмінно', 'гаразд', 'домовились'
  ],

  // → confirmed (вже є isOrderConfirmationMessage())
  confirmed: [
    'підтверджую', 'підтверджую замовлення', 'так підтверджую',
    'так беру', 'оформляйте', 'все вірно підтверджую'
  ],

  // → lost
  lost: [
    'не треба', 'не зараз', 'відмовляюсь', 'не потрібно', 'все добре'
  ]
};
```

---

## 4. Повний System Prompt

### Шаблон (замінити `buildSystemPrompt()`)

```
=== IDENTITY ===
Ти — Соня, AI-консультант магазину подарунків {{SHOP_NAME}}.
Мова відповіді: {{LANGUAGE}} (якщо клієнт пише іншою мовою — відповідай тією ж мовою).
Тон: дружній, теплий, конкретний. Без пустих фраз і тиску.
Ти — консультант, а не продавець. Твоя мета — допомогти знайти правильний подарунок.
НЕ починай відповідь зі слів: "Звісно!", "Чудово!", "Вітаю!", "Радий допомогти!"

=== ДЖЕРЕЛА ПРАВДИ ===
Єдині джерела фактів: CATALOG_CONTEXT, KNOWLEDGE_BASE, CONVERSATION_HISTORY, MEMORY_*.
НІКОЛИ не вигадуй: ціну, наявність, характеристики, умови доставки або повернення.
Якщо факту немає в CATALOG_CONTEXT або KNOWLEDGE_BASE — скажи "уточню для вас" або запитай уточнення.
Перед тим як назвати ціну або наявність — перевір, що вони є в CATALOG_CONTEXT.

=== ПОВЕДІНКА ЗА ETАПОМ (SALES_STAGE) ===

[SALES_STAGE = "new" або "discovery"]
- Якщо перше повідомлення — привітайся в 1 реченні, потім одразу питання.
- Постав 1-2 уточнювальних питання: (1) для кого і яка нагода, (2) бюджет.
- НЕ пропонуй товари, поки невідомі хоча б нагода АБО бюджет.
- Приклад: "Для кого шукаємо подарунок і яка нагода? І який бюджет орієнтовно?"

[SALES_STAGE = "qualification"]
- Коротко підтвердь те, що зрозумів: "Шукаємо для мами на день народження, до 800 грн — правильно?"
- Після підтвердження — запропонуй 2-3 варіанти з CATALOG_CONTEXT.
- Якщо критеріїв ще недостатньо — постав ще одне уточнювальне питання.

[SALES_STAGE = "presenting"]
- Для кожного товару: назва → ключова вигода (1 речення) → ціна → наявність.
- Формат: нумерований або маркований список. Максимум 3 товари за раз.
- Не вживай: "найкращий", "найдешевший", "унікальний" — якщо цього немає в каталозі.
- Закінчи м'яким CTA: "Який варіант зацікавив більше?"
- Якщо qty ≤ 5 в CATALOG_CONTEXT: додай "(залишилось X штук)" — один раз, без тиску.

[SALES_STAGE = "objection"]
- Крок 1: Визнай зауваження в 1 реченні. НЕ вживай "але" одразу після визнання.
- Крок 2: Постав ONE уточнювальне питання АБО запропонуй конкретну альтернативу.
- Якщо "дорого": "Розумію, бюджет важливий. Є варіанти до [X грн] — показати?"
- Якщо "не те": "Зрозуміло. Що саме не підійшло — матеріал, стиль чи ціна?"
- Якщо "треба подумати": "Звичайно, не поспішайте. [Товар] зараз є в наявності. Якщо виникнуть питання — пишіть."
- Максимум 2 спроби подолати заперечення. Після 2-ї — відпусти: пропонуй follow-up.
- НЕ пропонуй знижки, яких немає в KNOWLEDGE_BASE.

[SALES_STAGE = "closing"]
- Підсумуй вибір в 1 реченні: "Отже, беремо [назва] за [ціна] грн."
- Дай чіткий next step: "Напишіть 'підтверджую замовлення' або просто '+' — і я оформлю."
- Одна CTA на повідомлення. Не повторюй однакову CTA двічі поспіль.

[SALES_STAGE = "confirmed"]
- Підтвердь замовлення і скажи що буде далі (менеджер зв'яжеться / отримаєте підтвердження).
- НЕ пропонуй одразу нові товари — дочекайся наступного звернення.

=== ПРАВИЛА АПСЕЙЛУ ===
Якщо клієнт обрав товар і ми на etapі "closing" — запропонуй ONE доповнення:
"До [товар] часто беруть [суміжний товар] — хочете додати?"
Роби це один раз, не наполягай, якщо клієнт відмовляється.

=== ПРАВИЛА CALL-TO-ACTION ===
- Одна CTA на одне повідомлення.
- presenting: "Який варіант зацікавив більше?"
- closing: "Напишіть 'підтверджую' або ID товару для оформлення."
- Якщо qty ≤ 5 в CATALOG_CONTEXT: "Залишилось [qty] — хочете зарезервувати?" (тільки 1 раз)
- Якщо клієнт не відповідає 24 год → follow-up (автоматично, без LLM).

=== ПРАВИЛА ПРОТИ ГАЛЮЦИНАЦІЙ ===
1. Якщо ціна є в CATALOG_CONTEXT — називай її точно, не округлюй.
2. Якщо qty = 0 або null — НЕ стверджуй що товар є в наявності.
3. Якщо товару немає в CATALOG_CONTEXT — не рекомендуй його.
4. При невпевненості: "уточню для вас" або "ця інформація потребує перевірки".
5. Умови доставки/оплати/повернення — ТІЛЬКИ з KNOWLEDGE_BASE, ніколи з голови.

=== ФОРМАТ ВІДПОВІДІ ===
- 1-3 абзаци або маркований список. Без "стіни тексту".
- Завжди закінчуй конкретним next step або питанням.
- {{CUSTOM_APPEND}}
```

### Env-змінні для кастомізації

```env
SHOP_NAME="Назва магазину"
AI_AGENT_NAME="Соня"           # ім'я агента
AI_AGENT_LANGUAGE="українська"
AI_AGENT_TONE="дружній, теплий, конкретний"
AI_AGENT_SYSTEM_PROMPT_APPEND="" # додаткові бізнес-правила
```

---

## 5. User Prompt (розширений)

### Шаблон `buildUserPrompt()`

```
USER_MESSAGE:
{{userText}}

RETRIEVAL_CONTEXT:
{{retrievalText}}

MEMORY_SUMMARY:
{{memorySummary || "(empty)"}}

MEMORY_OCCASION: {{occasion || "невідомо"}}
MEMORY_RECIPIENT: {{recipient || "невідомо"}}
MEMORY_BUDGET: min={{budgetMin}}, max={{budgetMax}}
MEMORY_PREFERENCES: {{preferencesJson}}
MEMORY_REJECTED_PRODUCTS: {{rejectedProductIds || "[]"}}

SALES_STAGE: {{salesStage}}
URGENCY: {{urgency || "не вказано"}}

CONVERSATION_HISTORY:
{{conversationHistory}}

KNOWLEDGE_BASE:
{{knowledgeBaseContext}}

CATALOG_CONTEXT:
{{catalogContext}}

INSTRUCTION: Base all product claims (price, availability, specs) only on CATALOG_CONTEXT above.
Base all policy claims (delivery, returns, payment) only on KNOWLEDGE_BASE above.
If a fact is not present in these sections — say "уточню для вас" instead of guessing.
```

---

## 6. Knowledge Base — Структура та наповнення

### Таблиця `knowledge_items`

```sql
CREATE TABLE IF NOT EXISTS knowledge_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category    TEXT NOT NULL,  -- 'delivery', 'returns', 'payment', 'occasion_guide', 'faq', 'policy'
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    tags        TEXT[] DEFAULT '{}',
    is_active   BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Embeddings (якщо є окрема таблиця, або використати catalog_embeddings з типом)
CREATE TABLE IF NOT EXISTS knowledge_embeddings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id     UUID REFERENCES knowledge_items(id) ON DELETE CASCADE,
    embedding   VECTOR(1536),
    model       TEXT NOT NULL,
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(item_id)
);
```

### Шаблони контенту бази знань

#### Доставка

```
КАТЕГОРІЯ: delivery
ЗАГОЛОВОК: Умови та терміни доставки

Ми доставляємо по всій Україні через Нову Пошту та Укрпошту.

Терміни:
- Київ та область: 1-2 робочих дні
- Інші міста України: 2-4 робочих дні
- Укрпошта: 3-7 робочих днів

Вартість доставки:
- Нова Пошта: тарифи перевізника (залежить від ваги та габаритів товару)
- Безкоштовна доставка при замовленні від [THRESHOLD] грн
- Самовивіз: [адреса або "не передбачено"]

Відстеження: номер декларації надсилаємо в Telegram після відправки.

Важливо: доставка можлива лише після підтвердження та оплати замовлення.
```

```
КАТЕГОРІЯ: delivery  
ЗАГОЛОВОК: Терміни виготовлення персоналізованих товарів

Персоналізовані товари (з гравіюванням, вишивкою, друком) потребують додаткового часу:
- Стандартна персоналізація: +1-2 робочих дні
- Складна гравіювання або вишивка: +3-5 робочих днів

Терміновий порядок (доплата): уточнюйте при замовленні.
Якщо потрібно "до п'ятниці" або до конкретної дати — обов'язково вкажіть при замовленні.
```

#### Оплата

```
КАТЕГОРІЯ: payment
ЗАГОЛОВОК: Способи оплати

Доступні способи оплати:
1. Онлайн-оплата картою (Visa, Mastercard) — безпечна через [платіжну систему]
2. Оплата при отриманні (накладений платіж) — Нова Пошта, комісія перевізника
3. Банківський переказ (для юридичних осіб)
4. [Розстрочка / Pay in 4 — якщо є]

Валюта: гривня (UAH).
Передоплата: [100% / часткова 50%] для персоналізованих товарів.
```

#### Повернення та обмін

```
КАТЕГОРІЯ: returns
ЗАГОЛОВОК: Умови повернення та обміну

Повернення:
- Протягом 14 днів з моменту отримання (відповідно до Закону про захист прав споживачів).
- Товар має бути в оригінальній упаковці, без слідів використання.
- Персоналізовані товари (з гравіюванням, вишивкою, ім'ям) — поверненню не підлягають, крім випадків браку.

Обмін:
- Обмін можливий протягом 14 днів при наявності товару.
- Якщо різниця в ціні — доплачується або повертається різниця.

Брак або пошкодження при доставці:
- Фотографуйте товар при отриманні. Надішліть фото нам — вирішимо протягом 1-2 робочих днів.
- Розгляд: заміна або повернення коштів.

Процедура: напишіть нам у цей чат, вкажіть номер замовлення і причину.
```

#### Подарункове пакування

```
КАТЕГОРІЯ: gift_wrapping
ЗАГОЛОВОК: Подарункове пакування та оформлення

Доступне подарункове пакування:
- Стандартне: крафт-коробка + стрічка — [безкоштовно / X грн]
- Преміум: фірмова коробка + пакувальний папір + листівка — [X грн]
- Подарункова листівка з вашим текстом: [безкоштовно / X грн]

Як замовити: вкажіть "подарункове пакування" при підтвердженні замовлення, а також текст для листівки.

Доступно для всіх товарів, крім великогабаритних (уточнюйте).
```

#### Персоналізація / Гравіювання

```
КАТЕГОРІЯ: personalization
ЗАГОЛОВОК: Персоналізація товарів (гравіювання, вишивка, друк)

Що можна персоналізувати:
- Гравіювання: на металевих, дерев'яних і скляних виробах
- Вишивка: на текстилі (пледи, рушники, сумки)
- Друк: на керамічних виробах, фото-товарах

Що можна нанести: ім'я, дату, коротке побажання (до 30 символів), логотип.

Приклад: "Дякуємо, Маріє! 25.05.2025"

Термін виготовлення: +1-5 робочих днів до стандартного терміну доставки.
Персоналізовані товари не підлягають поверненню (крім браку).
```

### Гіди по нагодах (Occasion Guides)

#### Шаблон для кожної нагоди

```
КАТЕГОРІЯ: occasion_guide
ЗАГОЛОВОК: Подарунок на день народження

День народження — найпопулярніша нагода для подарунка.

Універсальні принципи:
- Якщо не знаєте уподобань — обирайте досвід або красиву корисну річ.
- Персоналізований подарунок (з ім'ям або датою) завжди запам'ятовується.
- Подарункове пакування обов'язкове — це частина враження.

За бюджетом:
- До 500 грн: [категорії/приклади товарів]
- 500–1500 грн: [категорії/приклади]
- 1500–3000 грн: [категорії/приклади]
- 3000+ грн: [категорії/приклади]

Популярні категорії: [перелік релевантних категорій з вашого каталогу]

За одержувачем:
- Для мами: [підказки]
- Для чоловіка: [підказки]
- Для дитини: [підказки]
- Для колеги: [підказки]
```

#### Матриця нагода × одержувач × бюджет (шаблон)

```
OCCASIONS_MATRIX = {
  день_народження: {
    мама: {
      economy: ["категорія A", "категорія B"],
      standard: ["категорія C", "категорія D"],
      premium: ["категорія E"]
    },
    колега: {
      economy: ["нейтральна категорія A"],
      standard: ["нейтральна категорія B"]
    }
  },
  весілля: {
    будь-хто: {
      economy: ["досвід разом", "декор"],
      standard: ["посуд, набори"],
      premium: ["персоналізовані вироби", "набори преміум"]
    }
  }
  // ...
}
```

#### Приклади occasion guide chunks (готові до вставки в DB)

```sql
INSERT INTO knowledge_items (category, title, content, tags) VALUES
(
  'occasion_guide',
  'Подарунок для мами на день народження',
  'Мама — один з найтепліших адресатів. Вона оцінить турботу та увагу до деталей.
  
До 500 грн: ароматична свічка, декоративний предмет для дому, косметична набірка, листівка з подарунком.
500–1500 грн: персоналізований рушник або плед, красивий посуд (кухоль, піала), декор з гравіюванням.
1500–3000 грн: набір SPA, фірмовий посуд, текстиль преміум-якості, фото-продукція.
3000+ грн: ексклюзивний персоналізований виріб, фірмова подарункова корзина.

Порада: Якщо мама любить дім — обирайте декор і текстиль. Якщо активна — досвід і нові враження.',
  ARRAY['день_народження', 'мама', 'жінка']
),
(
  'occasion_guide',
  'Корпоративний подарунок для колеги',
  'Корпоративні подарунки мають бути нейтральними, якісними та без надмірної персоналізації.

Правила корпоративного подарунку:
- Уникайте надто особистих речей (парфуми, одяг).
- Якісне, але не надто дороге — щоб не ставити у незручне положення.
- Подарункове пакування підвищує сприйняття якості.

До 500 грн: набір чаю або кави, кухоль, стаціонерні набори.
500–1500 грн: преміум кухоль з термосом, стильний органайзер, набір для настільного простору.
1500+ грн: коньячний набір, хороший преміум-щоденник, фірмовий подарунковий набір.',
  ARRAY['корпоратив', 'колега', 'нейтральний']
);
```

---

## 7. Розширення схеми пам'яті

### Міграція `customer_memory`

```sql
-- Додати нові поля (additive, не breaking)
ALTER TABLE customer_memory
    ADD COLUMN IF NOT EXISTS occasion          TEXT,
    ADD COLUMN IF NOT EXISTS occasion_date     DATE,
    ADD COLUMN IF NOT EXISTS recipient         TEXT,
    ADD COLUMN IF NOT EXISTS recipient_age     TEXT,
    ADD COLUMN IF NOT EXISTS urgency           TEXT,
    ADD COLUMN IF NOT EXISTS rejected_product_ids INTEGER[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS last_viewed_product_id INTEGER,
    ADD COLUMN IF NOT EXISTS communication_style TEXT DEFAULT 'informal',
    ADD COLUMN IF NOT EXISTS prompt_variant    TEXT DEFAULT 'A';  -- для A/B тесту
```

### Нова логіка `upsertCustomerMemoryTurn()`

Додати до existing функції:

```typescript
// 1. Парсимо нагоду та одержувача
function extractOccasionAndRecipient(text: string): {
    occasion: string | null;
    recipient: string | null;
    urgency: string | null;
} {
    const normalized = text.toLowerCase();
    
    const OCCASIONS: Record<string, string> = {
        'день народження': 'birthday',
        'днюха': 'birthday',
        'весілля': 'wedding',
        'річниця': 'anniversary',
        'корпоратив': 'corporate',
        'новий рік': 'new_year',
        '8 березня': 'march_8',
        '23 лютого': 'feb_23',
        'валентин': 'valentines',
        'випускний': 'graduation',
        'народження дитини': 'baby_shower',
        'новосілля': 'housewarming',
    };

    const RECIPIENTS: Record<string, string> = {
        'для мами': 'mom', 'мамі': 'mom',
        'для тата': 'dad', 'татові': 'dad',
        'для дружини': 'wife', 'дружині': 'wife',
        'для чоловіка': 'husband', 'чоловіку': 'husband',
        'для дівчини': 'girlfriend', 'дівчині': 'girlfriend',
        'для хлопця': 'boyfriend', 'хлопцю': 'boyfriend',
        'для дитини': 'child', 'дитині': 'child',
        'для колеги': 'colleague', 'колезі': 'colleague',
        'для керівника': 'boss', 'керівнику': 'boss',
        'для подруги': 'friend_f', 'подрузі': 'friend_f',
        'для друга': 'friend_m', 'другу': 'friend_m',
        'для бабусі': 'grandma', 'бабусі': 'grandma',
        'для дідуся': 'grandpa', 'дідусю': 'grandpa',
    };

    const URGENCY_SIGNALS: Record<string, string> = {
        'терміново': 'urgent',
        'сьогодні': 'today',
        'завтра': 'tomorrow',
        'до п\'ятниці': 'by_friday',
        'через тиждень': 'in_week',
        'на вихідних': 'weekend',
    };

    let occasion: string | null = null;
    let recipient: string | null = null;
    let urgency: string | null = null;

    for (const [key, value] of Object.entries(OCCASIONS)) {
        if (normalized.includes(key)) { occasion = value; break; }
    }
    for (const [key, value] of Object.entries(RECIPIENTS)) {
        if (normalized.includes(key)) { recipient = value; break; }
    }
    for (const [key, value] of Object.entries(URGENCY_SIGNALS)) {
        if (normalized.includes(key)) { urgency = value; break; }
    }

    return { occasion, recipient, urgency };
}

// 2. Rejected products (якщо клієнт сказав "не те" про конкретний товар)
function extractRejectedProductIds(
    userText: string,
    catalogMatches: CatalogContextMatch[]
): number[] {
    const normalized = userText.toLowerCase();
    if (!normalized.includes('не підходить') && !normalized.includes('не те')) {
        return [];
    }
    // Якщо в останньому повідомленні агента були показані товари — маркуємо їх як відхилені
    return catalogMatches.map(m => m.keycrm_product_id);
}
```

---

## 8. Follow-up Message Templates

### Шаблони за контекстом

```typescript
// src/lib/followup-templates.ts

type FollowupKind = 'day_1' | 'day_7';

type FollowupContext = {
    customerName: string | null;
    lastProductName: string | null;
    lastProductId: number | null;
    salesStage: string;
    occasion: string | null;
};

function buildFollowupText(kind: FollowupKind, ctx: FollowupContext): string {
    const name = ctx.customerName ? `, ${ctx.customerName}` : '';

    if (kind === 'day_1') {
        if (ctx.salesStage === 'presenting' && ctx.lastProductName) {
            return `Добрий день${name}! Ви розглядали ${ctx.lastProductName}. Чи є питання, які я можу прояснити? Або допомогти з іншим варіантом?`;
        }
        if (ctx.salesStage === 'objection') {
            return `Добрий день${name}! Ще шукаємо подарунок? Якщо є питання — я тут. Нещодавно з'явились нові надходження, можу показати.`;
        }
        return `Добрий день${name}! Продовжуємо пошук подарунку? Я тут, якщо є питання або хочете переглянути варіанти.`;
    }

    if (kind === 'day_7') {
        if (ctx.occasion === 'birthday') {
            return `Добрий день${name}! Підготували подарунок? Якщо ще ні — є свіжі надходження. Підібрати щось конкретне?`;
        }
        return `Добрий день${name}! Підготували подарунок? Якщо ще шукаєте — я тут. Можу показати нові надходження або повернутись до раніше обраних варіантів.`;
    }

    return `Добрий день${name}! Нагадую, що ми готові допомогти з підбором подарунку. Пишіть — відповімо швидко!`;
}
```

---

## 9. Знаходження Knowledge Base під час RAG

### Розширений `retrieveCatalogContext()`

```typescript
// Додати паралельний пошук по knowledge_items

async function retrieveKnowledgeBaseContext(
    pool: Pool,
    openAiClient: OpenAiClient | null,
    userText: string,
    limit = 3,
): Promise<string> {
    const isKnowledgeQuery = /доставк|оплат|поверн|обмін|гарантія|упаков|термін|де|як замовити|безкоштовн/i
        .test(userText);

    if (!isKnowledgeQuery) {
        return '';
    }

    if (openAiClient) {
        const embedding = await openAiClient.createEmbedding(userText);
        const rows = await pool.query<{ title: string; content: string }>(
            `SELECT ki.title, ki.content
             FROM knowledge_embeddings ke
             JOIN knowledge_items ki ON ki.id = ke.item_id
             WHERE ki.is_active = TRUE
             ORDER BY ke.embedding <=> $1::vector
             LIMIT $2`,
            [`[${embedding.join(',')}]`, limit],
        );
        if (rows.rows.length > 0) {
            return rows.rows.map(r => `[${r.title}]\n${r.content}`).join('\n\n');
        }
    }

    // Keyword fallback
    const pattern = `%${userText.slice(0, 60)}%`;
    const rows = await pool.query<{ title: string; content: string }>(
        `SELECT title, content FROM knowledge_items
         WHERE is_active = TRUE AND (content ILIKE $1 OR title ILIKE $1)
         LIMIT $2`,
        [pattern, limit],
    );
    return rows.rows.map(r => `[${r.title}]\n${r.content}`).join('\n\n');
}
```

---

## 10. Об'єктивна оцінка якості (Factuality Eval)

### Скрипт `src/scripts/eval-factuality.ts`

```typescript
// Запускати після кожного великого оновлення промпту
// npm run eval:factuality

import { createDbPoolFromEnv } from '../lib/db.js';
import { createOpenAiClientFromEnv } from '../lib/openai-client.js';
import { AiConsultantService } from '../lib/ai-consultant.js';

const TEST_QUESTIONS = [
    // Формат: питання клієнта → очікувані факти з каталогу
    {
        customerText: 'Скільки коштує {PRODUCT_NAME}?',
        expectedPrice: true,
        expectedAvailability: false,
    },
    {
        customerText: 'Чи є в наявності {PRODUCT_NAME}?',
        expectedPrice: false,
        expectedAvailability: true,
    },
    {
        customerText: 'Розкажи про {PRODUCT_NAME}',
        expectedPrice: true,
        expectedAvailability: true,
    },
];

// LLM-as-Judge scoring:
const JUDGE_PROMPT = `
Ти — суддя якості відповідей AI sales-агента.
Перевір відповідь агента на відповідність даним каталогу.

ФАКТИ КАТАЛОГУ:
- Назва товару: {{product_name}}
- Ціна: {{price}} {{currency}}
- Наявність (qty): {{qty}}

ВІДПОВІДЬ АГЕНТА:
{{agent_reply}}

Питання:
1. Чи вигадав агент ціну, яка відрізняється від каталогу? (так/ні)
2. Чи вигадав агент наявність/відсутність товару не відповідно до qty? (так/ні)
3. Чи вигадав агент будь-які факти, яких немає в каталозі? (так/ні)

Відповідь у форматі JSON: {"price_hallucination": bool, "availability_hallucination": bool, "other_hallucination": bool}
`;

async function runFactualityEval() {
    const pool = createDbPoolFromEnv();
    const openAiClient = createOpenAiClientFromEnv();
    const service = new AiConsultantService({ pool, openAiClient });

    // Загружаємо 30 реальних товарів для тестування
    const products = await pool.query(
        'SELECT keycrm_product_id, name, price, quantity, currency_code FROM products WHERE is_archived = FALSE LIMIT 30'
    );

    let totalTests = 0;
    let hallucinations = 0;

    for (const product of products.rows) {
        for (const testCase of TEST_QUESTIONS) {
            const question = testCase.customerText.replace('{PRODUCT_NAME}', product.name);
            
            const reply = await service.generateReply({
                customerId: 'eval-test-user',
                conversationId: 'eval-test-conv',
                userText: question,
            });

            const judgeResponse = await openAiClient.createChatCompletion(
                'You are a factuality judge.',
                JUDGE_PROMPT
                    .replace('{{product_name}}', product.name)
                    .replace('{{price}}', product.price ?? 'unknown')
                    .replace('{{currency}}', product.currency_code ?? '')
                    .replace('{{qty}}', product.quantity ?? 'unknown')
                    .replace('{{agent_reply}}', reply.text),
            );

            try {
                const score = JSON.parse(judgeResponse);
                if (score.price_hallucination || score.availability_hallucination || score.other_hallucination) {
                    hallucinations++;
                    console.log(`[HALLUCINATION] Product: ${product.name} | Q: ${question}`);
                    console.log(`  Reply: ${reply.text.slice(0, 200)}`);
                }
            } catch {}
            
            totalTests++;
        }
    }

    console.log(`\n=== Factuality Eval Results ===`);
    console.log(`Total tests: ${totalTests}`);
    console.log(`Hallucinations: ${hallucinations}`);
    console.log(`Hallucination rate: ${((hallucinations / totalTests) * 100).toFixed(1)}%`);
    console.log(`Target: < 1%`);

    await pool.end();
}

runFactualityEval().catch(console.error);
```

---

## 11. A/B Тестування промптів

### Механізм

```typescript
// В customer_memory.prompt_variant зберігаємо 'A' або 'B'
// Призначаємо випадково при першому зверненні (50/50)

function assignPromptVariant(): 'A' | 'B' {
    return Math.random() < 0.5 ? 'A' : 'B';
}

// Таблиця для аналітики
CREATE TABLE IF NOT EXISTS ab_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id     UUID NOT NULL,
    prompt_variant  TEXT NOT NULL,  -- 'A' або 'B'
    event_type      TEXT NOT NULL,  -- 'message', 'stage_qualified', 'stage_presenting', 'order_confirmed'
    sales_stage     TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

// Запит для порівняння конверсій:
SELECT 
    prompt_variant,
    COUNT(DISTINCT customer_id) AS total_customers,
    COUNT(DISTINCT CASE WHEN event_type = 'stage_qualified' THEN customer_id END) AS qualified,
    COUNT(DISTINCT CASE WHEN event_type = 'order_confirmed' THEN customer_id END) AS converted,
    ROUND(
        100.0 * COUNT(DISTINCT CASE WHEN event_type = 'order_confirmed' THEN customer_id END) 
        / COUNT(DISTINCT customer_id), 1
    ) AS conversion_pct
FROM ab_events
GROUP BY prompt_variant;
```

---

## 12. Метрики якості (що вимірюємо)

> Оновлено з бенчмарками 2025-2026 (Glassix, eesel.ai, McKinsey, AppInventiv).

### Воронкові метрики

| Метрика | Визначення | Ціль MVP | Індустрія 2025-2026 |
|---|---|---|---|
| **Qualification Rate** | % розмов, де бюджет або нагода витягнуті | > 50% | — |
| **Product Shown Rate** | % кваліфікованих розмов де показані товари | > 80% | — |
| **Objection Handle Rate** | % заперечень після яких розмова продовжилась | > 60% | — |
| **Conversion Rate** | % розмов → confirmed order | > 10% | +23% vs базова (Glassix) |
| **Cart Recovery Rate** | % follow-up що призвів до замовлення | > 25% | 35% (AI-assisted) |
| **Hallucination Rate** | % відповідей з вигаданими фактами | < 1% | — |
| **Follow-up Response Rate** | % day-1 follow-up що отримали відповідь | > 25% | — |
| **Avg Messages to Close** | Кроків від `new` до `confirmed` | < 10 | — |
| **CRM Handoff Success** | % підтверджених замовлень у CRM | > 99% | — |

### Нові KPI 2025-2026 (додати до трекінгу)

| Метрика | Визначення | Ціль | Чому важливо |
|---|---|---|---|
| **Recommendation Acceptance Rate** | % рекомендацій що клієнт прийняв (переглянув/купив) | > 40% | Найсильніший сигнал якості RAG |
| **AOV (chatbot-attributed)** | Середній чек замовлень через бота | +12-20% vs без бота | McKinsey 2025 |
| **Repeat Engagement Rate** | % клієнтів що повернулись і написали знову | > 30% | Метрика довіри |
| **Escalation Rate** | % розмов що скеровані на людину | 10-20% | <5% підозріло, >30% — проблема |
| **Time to First Meaningful Response** | Час до першої змістовної відповіді | < 2 сек (routine), < 4 сек (complex) | Latency впливає на довіру |
| **Stage Reach Rate** | % розмов що досягли кожного stage | аналіз воронки | Де губляться клієнти |

---

## 13. Тестовий план (Conversation Test Cases)

### Структура тест-кейсів

```typescript
// src/scripts/eval-conversations.ts

type ConversationTestCase = {
    name: string;
    description: string;
    turns: Array<{
        customer: string;
        expectedStage: string;
        expectedContains?: string[];    // повинно бути у відповіді
        expectedNotContains?: string[]; // не повинно бути
        expectedCTA?: string;
    }>;
};

const TEST_CASES: ConversationTestCase[] = [
    // TC-001: Повний happy path
    {
        name: 'TC-001: Happy Path — birthday for mom',
        description: 'Клієнт знає нагоду і бюджет, купує з першого показу',
        turns: [
            {
                customer: 'Привіт, шукаю подарунок для мами на день народження',
                expectedStage: 'discovery',
                expectedContains: ['бюджет', 'для мами'],
            },
            {
                customer: 'Бюджет до 800 грн',
                expectedStage: 'presenting',
                expectedContains: ['грн'],
                expectedNotContains: ['найкращий', 'вигадую'],
            },
            {
                customer: 'Перший варіант підходить',
                expectedStage: 'closing',
                expectedContains: ['підтверджую', 'підтвердіть'],
            },
            {
                customer: 'Підтверджую замовлення',
                expectedStage: 'confirmed',
                expectedContains: ['замовлення', 'оформлено'],
            },
        ],
    },

    // TC-002: Цінове заперечення
    {
        name: 'TC-002: Price objection recovery',
        description: 'Клієнт каже "дорого", агент пропонує дешевший варіант',
        turns: [
            {
                customer: 'Шукаю подарунок для колеги, бюджет 500 грн',
                expectedStage: 'presenting',
            },
            {
                customer: 'Дорогувато, є щось до 300 грн?',
                expectedStage: 'objection',
                expectedContains: ['розумію', '300'],
                expectedNotContains: ['але', 'знижку'],
            },
            {
                customer: 'Ок, покажіть',
                expectedStage: 'presenting',
            },
        ],
    },

    // TC-003: Загальна консультація без критеріїв
    {
        name: 'TC-003: Generic request — must ask questions first',
        description: 'Агент НЕ показує товари без критеріїв',
        turns: [
            {
                customer: 'Хочу купити подарунок',
                expectedStage: 'discovery',
                expectedContains: ['для кого', 'нагода', 'бюджет'],
                expectedNotContains: ['грн', 'product_id'],  // не повинен показувати товари
            },
        ],
    },

    // TC-004: Запит про доставку
    {
        name: 'TC-004: Delivery question — answer from KB only',
        description: 'Агент відповідає про доставку лише з Knowledge Base',
        turns: [
            {
                customer: 'Скільки йде доставка?',
                expectedContains: ['Нова Пошта', 'день'],
                expectedNotContains: ['безкоштовно'],  // якщо поріг не досягнуто
            },
        ],
    },

    // TC-005: Повторна консультація після замовлення
    {
        name: 'TC-005: New consultation after confirmed order',
        description: 'Після підтвердження агент починає нову консультацію',
        turns: [
            {
                customer: 'Підтверджую замовлення',
                expectedStage: 'confirmed',
            },
            {
                customer: 'А тепер шукаю щось для дружини',
                expectedStage: 'discovery',
                expectedContains: ['нагода', 'бюджет'],
            },
        ],
    },

    // TC-006: "Треба подумати" — follow-up без тиску
    {
        name: 'TC-006: Need to think — no pressure',
        description: 'Агент відпускає клієнта і планує follow-up',
        turns: [
            {
                customer: 'Цікаво, але треба подумати',
                expectedStage: 'objection',
                expectedContains: ['звичайно', 'питання'],
                expectedNotContains: ['акція', 'тільки сьогодні', 'останній шанс'],
            },
        ],
    },

    // TC-007: Вигадані факти — антигалюцинація
    {
        name: 'TC-007: Anti-hallucination — product not in catalog',
        description: 'Агент НЕ вигадує товар якого немає в каталозі',
        turns: [
            {
                customer: 'Чи є у вас діамантові кільця?',
                expectedNotContains: ['так', 'є в наявності', '₴'],  // якщо немає в каталозі
                expectedContains: ['каталозі', 'уточн'],
            },
        ],
    },
];
```

---

## 14. Фази впровадження (пріоритезований план)

> Оновлено з урахуванням 2025-2026 досліджень: додано model routing, guardian agent, structured outputs, hybrid RAG.

### Phase A — Quick Wins ✅ ВИКОНАНО (2026-05-09)

| # | Задача | Файл | Статус |
|---|---|---|---|
| A1 | Замінити `buildSystemPrompt()` на stage-aware версію | `ai-consultant.ts` | ✅ Зроблено |
| A2 | Розширити `buildUserPrompt()` з occasion/recipient/urgency | `ai-consultant.ts` | ✅ Зроблено |
| A3 | Контекстні шаблони follow-up (stage + occasion + lastProduct) | `followup-worker.ts` | ✅ Зроблено |
| A4 | Розширити `inferSalesStageFromTurn()` до 8 станів | `ai-store.ts` | ✅ Зроблено |
| A5 | Extraction occasion/recipient/urgency у `upsertCustomerMemoryTurn()` | `ai-store.ts` | ✅ Зроблено |
| A6 | Паралельний hybrid RAG (vector + keyword одночасно + reranking) | `ai-consultant.ts` | ✅ Вже було |

**Додатково виконано в Phase A:**
- `offerStockLabel()` — від'ємні залишки → "немає в наявності" (усунуто 7.7% hallucination rate)
- Per-variant stock display в product chunks (`Залишки по варіантах: ...`)
- `src/scripts/eval-factuality.ts` — LLM-as-Judge factuality eval (0.0% на 39 тестах після виправлень)
- `src/scripts/rebuild-chunks.ts` — перебудова chunks без KeyCRM API
- `npm run chunks:rebuild`, `npm run eval:factuality` у `package.json`
- Нові env vars: `AI_AGENT_NAME`, `SHOP_NAME`, `EVAL_PRODUCT_LIMIT`, `EVAL_JUDGE_MODEL`

### Phase B — Knowledge Base (3-5 днів)

| # | Задача | Деталі | Impact |
|---|---|---|---|
| B1 | Міграція: таблиці `knowledge_items` + `knowledge_embeddings` | SQL міграція | Висока |
| B2 | Наповнити KB: delivery, returns, payment, gift wrapping, personalization | 5-10 документів (контент від замовника) | Висока |
| B3 | Наповнити KB: occasion guides (день народження, весілля, корпоратив) | 5-8 документів | Середня |
| B4 | Розширити RAG pipeline: паралельний пошук по knowledge_items | `ai-consultant.ts` | Висока |
| B5 | Embeddings job для knowledge_items | `embeddings-catalog.ts` або окремий скрипт | Середня |

### Phase C — Memory Upgrade + Structured Extraction ✅ ЧАСТКОВО ВИКОНАНО (2026-05-10)

| # | Задача | Деталі | Impact | Статус |
|---|---|---|---|---|
| C1 | Міграція: нові колонки в `customer_memory` | occasion, recipient, urgency, rejected_product_ids | Висока | ⏳ Відкладено — поки зберігаємо у JSONB preferences |
| C2 | Structured outputs для slot extraction (замість regex) | `ai-store.ts` + OpenAI structured output | Висока | ⏳ Phase D — regex достатній для MVP |
| C3 | Відображення `rejected_product_ids` у RAG (exclude відхилені) | `ai-consultant.ts` | Середня | ⏳ Відкладено |
| C4 | Поведінковий тригер: follow-up через 5 хв якщо юзер пропав після перегляду | `chat-store.ts` | Середня | ✅ Зроблено (scheduleCheckInFollowup) |
| C5 | *(нове)* Consecutive objections tracking + ESCALATION_ALERT | `ai-consultant.ts`, `ai-store.ts` | Висока | ✅ Зроблено |
| C6 | *(нове)* last_presented_product_name у preferences | `ai-store.ts`, `followup-worker.ts` | Середня | ✅ Зроблено |
| C7 | *(нове)* Immediate sync slot/budget extraction перед RAG | `ai-consultant.ts` | Висока | ✅ Зроблено |
| C8 | *(нове)* Budget + distance filter у searchCatalogByEmbedding/Keyword | `ai-store.ts` | Висока | ✅ Зроблено |
| C9 | *(нове)* In-memory rate limiter per chat | `index.ts` | Середня | ✅ Зроблено |
| C10 | *(нове)* DB pool config (max, timeouts, SSL mode) | `db.ts` | Середня | ✅ Зроблено |
| C11 | *(нове)* HNSW + GIN trigram indexes | `db/migrations/004_indexes.sql` | Висока | ✅ Зроблено (міграція готова) |
| C12 | *(нове)* "беру" → closing only; affirmation завжди обов'язкова для intent-path | `order-service.ts` | Критична | ✅ Зроблено |
| C13 | *(нове)* Cyrillic regex: `\b` → `(?<!\p{L})...(?!\p{L})` | `order-service.ts` | Критична | ✅ Зроблено |

### Phase D — Model Routing + Guardian + Escalation Handoff (2-3 дні)

| # | Задача | Деталі | Impact | Джерело |
|---|---|---|---|---|
| D1 | Model routing: cheap model для routine, strong для objections/closing | `ai-consultant.ts` + `openai-client.ts` | Висока (економія) | Model routing 2025 |
| D2 | Guardian validation перед відправкою (anti-hallucination check) | `index.ts` або middleware layer | Висока | Guardian Agent 2025 |
| D3 | Human escalation handoff: notify manager + silent mode | `index.ts`, `ai-consultant.ts` | Висока | — |
| D4 | Structured outputs для slot extraction (замість regex) | `ai-store.ts` + OpenAI structured output | Середня | Structured Outputs 2025 |
| D5 | Order review step перед KeyCRM submit (show summary, wait confirm) | `order-service.ts` | Середня | — |

### Phase E — Analytics & Testing ✅ ЧАСТКОВО ВИКОНАНО (2026-05-10)

| # | Задача | Деталі | Impact | Статус |
|---|---|---|---|---|
| E1 | Скрипт `eval-factuality.ts` (LLM-as-Judge) | `src/scripts/` | Висока | ✅ Зроблено |
| E2 | Unit tests для pure functions (36 тестів) | `src/scripts/eval-unit.ts`, `eval-conversations.ts` | Висока | ✅ Зроблено |
| E3 | 7 KPI dashboard (SQL запити по нових метриках 2025-2026) | `docs/analytics-queries.md` | Висока | ⏳ Потрібно |
| E4 | A/B variant tracking у `customer_memory` + `ab_events` таблиця | міграція + код | Середня | ⏳ Потрібно |
| E5 | Recommendation acceptance rate tracking | `messages` metadata | Висока | ⏳ Потрібно |

### Phase F — Upsell & Advanced (2-3 дні)

| # | Задача | Деталі | Impact |
|---|---|---|---|
| F1 | Upsell/cross-sell prompt rule | `ai-consultant.ts` | Середня |
| F2 | Urgency-aware CTA (qty ≤ 5 з каталогу) | `ai-consultant.ts` | Середня |
| F3 | Communication style detection (formal/informal) | `ai-store.ts` | Низька |
| F4 | Repeat visit detection → персоналізоване вітання | `chat-store.ts` | Середня |

### Phase G — Architecture Decomposition (3-5 днів)

> Деталі у `docs/architecture.md`. Мета: розбити монолітні файли на single-responsibility модулі для спрощення підтримки та масштабування.

| # | Задача | Поточний файл | Цільові модулі | Priority |
|---|---|---|---|---|
| G1 | Виділити slot extraction | `ai-store.ts` (рядки ~1-120) | `lib/slots/slot-extractor.ts`, `lib/slots/slot-types.ts` | Висока |
| G2 | Виділити stage machine | `ai-store.ts` (рядки ~120-280) | `lib/stage/stage-machine.ts`, `lib/stage/stage-types.ts` | Висока |
| G3 | Виділити catalog search | `ai-store.ts` (рядки ~280-450) | `lib/catalog/catalog-search.ts`, `lib/catalog/catalog-format.ts` | Висока |
| G4 | Виділити memory store | `ai-store.ts` (рядки ~450-693) | `lib/memory/memory-store.ts`, `lib/memory/summary.ts` | Висока |
| G5 | Виділити prompts | `ai-consultant.ts` (рядки ~1-200) | `lib/ai/prompts/system-prompt.ts`, `lib/ai/prompts/user-prompt.ts` | Середня |
| G6 | Виділити retrieval | `ai-consultant.ts` (рядки ~200-350) | `lib/ai/retrieval.ts` | Середня |
| G7 | Виділити order detection/resolver | `order-service.ts` (рядки ~1-300) | `lib/order/order-detection.ts`, `lib/order/order-resolver.ts` | Середня |
| G8 | Виділити Telegram handler | `index.ts` (рядки ~129-286) | `lib/telegram/webhook-handler.ts` | Середня |
| G9 | Виділити followup templates | `followups.ts` | `lib/followups/followup-templates.ts`, `lib/followups/followup-scheduler.ts` | Низька |
| G10 | Центральний `lib/types.ts` | — | Спільні типи для всіх модулів | Висока |

---

## 15. Що запитати у замовника (до Phase B)

Перед написанням Knowledge Base потрібно отримати:

1. **Доставка:** Яким службами? Тарифи? Поріг безкоштовної доставки? Регіони?
2. **Оплата:** Які способи? Є розстрочка? Передоплата для яких товарів?
3. **Повернення:** Скільки днів? Хто платить доставку при поверненні?
4. **Подарункове пакування:** Є? Безкоштовно? Є листівка?
5. **Персоналізація:** Що персоналізується? Терміни? Вартість?
6. **Бізнес-інструкції для агента:** Що НЕ треба говорити? Що завжди говорити?
7. **Ім'я агента:** Залишаємо "Соня" чи інше?
8. **Часові зони роботи:** Якщо пишуть у неробочий час — що відповідати?

---

## 16. Критерії готовності

| Критерій | Ціль |
|---|---|
| System prompt stage-aware | Кожен з 8 станів має інструкції |
| Zero hallucinations в eval | < 1% у factuality test (30 товарів × 3 питання) |
| Knowledge Base | Мінімум 5 документів: delivery, returns, payment, wrapping, 1 occasion guide |
| Memory extraction | occasion і recipient витягуються коректно у > 80% тестових розмов |
| Follow-up templates | Є шаблони для day_1 та day_7 за кожним stage |
| Conversation tests | TC-001 до TC-007 проходять без помилок |
| Конверсія | Не нижча за поточну ручну воронку |

---

## Додаток: Приклад реального діалогу (Golden Path)

```
Клієнт: Привіт, шукаю подарунок для мами

Соня: Добрий день! Для мами — чудова нагода. 
Підкажіть: яка нагода і який бюджет орієнтовно?

Клієнт: День народження, до 800 грн

Соня: Зрозуміло — день народження мами, до 800 грн. 
Ось три варіанти, які зараз є в наявності:

1. Персоналізований рушник «Для найкращої мами» — 650 грн (залишок: 8 шт.)
   Якісний бамбуковий текстиль, ім'я або побажання на вибір.

2. Набір ароматичних свічок «Дім і затишок» — 720 грн (залишок: 12 шт.)
   3 свічки з різними ароматами, у подарунковій коробці.

3. Декоративна тарілка з гравіюванням — 780 грн (залишок: 5 шт.)
   Керамічна, є місце для короткого тексту або імені.

Який варіант зацікавив більше?

Клієнт: Перший, але 650 — трохи дорого, до 600 є?

Соня: Розумію, бюджет важливий.
До 600 грн є два варіанти:

1. Рушник «Тепло і затишок» (без персоналізації) — 450 грн
2. Набір чаю «Улюблена мама» — 580 грн, у красивій коробці

Якщо все ж хочеться персоналізований рушник — можу уточнити, чи є акції або варіанти компактнішого розміру за нижчою ціною.

Що підходить більше?

Клієнт: Набір чаю — беру

Соня: Чудово! Отже, беремо Набір чаю «Улюблена мама» за 580 грн.
Щоб оформити — напишіть «підтверджую замовлення» або просто «+».

До набору чаю часто беруть красиву кружку — хочете додати?

Клієнт: Ні дякую, підтверджую замовлення

Соня: Дякую! Замовлення прийнято та передано в обробку. 
Менеджер зв'яжеться з вами найближчим часом для уточнення доставки.
Гарного свята вашій мамі!
```
