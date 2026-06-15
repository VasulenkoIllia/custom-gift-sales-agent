# custom-gift-sales-agent

Telegram-бот **техпідтримки та консультацій** для LED-ламп бренду **INTELLECT** (квадратні лампи, зроблено в Україні).

Користувач пише боту питання → бот шукає відповідь у базі знань (RAG) і відповідає українською, спираючись **виключно** на базу (без галюцинацій). База знань редагується через веб-адмінку.

## Сервіси в Docker
| Сервіс | Контейнер | Що це |
|---|---|---|
| `app` | `${APP_NAME}-app` | Node/TS бот: Telegram webhook, RAG, веб-адмінка `/admin`, захист від спаму/витрат |
| `postgres` | `${APP_NAME}-postgres` | PostgreSQL 16 + **pgvector** — база знань (`kb_entries` з ембедингами), історія діалогів, лічильники guard |

`APP_NAME=custom-gift-sales-agent` → контейнери `custom-gift-sales-agent-app` / `custom-gift-sales-agent-postgres`.

## Як це працює
- **RAG**: гібридний пошук по `kb_entries` — вектор (OpenAI embeddings) + повнотекстовий + trigram (українська морфологія), м'який буст за категорією.
- **Питання/відповідь розділені**: ембедиться лише питання + синоніми; відповідь — окремо (бот не плутає Q і A).
- **Адмінка** `/admin`: CRUD записів, тест-пошук, тест-відповідь, налаштування агента, кнопка «🔄 Оновити пошук».
- **Захист від витрат**: ліміти на користувача (10с/хв/год/день), strikes→mute, бюджет-kill-switch, кеш відповідей, облік токенів.

## Стек
Node 20 + TypeScript (запуск через `tsx`, без білд-кроку) · PostgreSQL 16 + pgvector · OpenAI (`gpt-4.1-mini` + `text-embedding-3-small`) · Telegram Bot API · Docker + Traefik.

## Структура
- `src/index.ts` — HTTP-сервер (Telegram webhook + `/admin` + `/health`)
- `src/lib/` — `rag.ts` (пошук), `ai-consultant.ts` (оркестратор), `abuse-guard.ts` (захист), `admin-api.ts`, `kb-store.ts`, `agent-config.ts`, `openai-client.ts`, `chat-store.ts`, `telegram-client.ts`
- `src/config/` — промпти агента, категорії
- `src/admin/index.html` — веб-адмінка (Alpine.js, без білду)
- `db/init/` — `01_schema.sql` + `02_seed.sql` (Postgres ініціюється цим на першому старті)
- `db/migrations/` — міграції для майбутніх змін схеми
- `docs/DEPLOY.md` — інструкція розгортання на сервер

## Локальний запуск
```bash
cp .env.example .env            # заповніть OPENAI_API_KEY, TELEGRAM_BOT_TOKEN, ADMIN_USER/PASSWORD
docker compose up -d postgres   # підняти БД
npm install
npm run db:migrate              # схема (на чистій БД)
npm run dev                     # запустити бота
npm run telegram:poll           # у 2-му терміналі — міст getUpdates → локальний webhook
```
Адмінка: `http://localhost:3000/admin`.

## Наповнення бази знань
Через `/admin`: додати/редагувати запис → «🔄 Оновити пошук». Зміни застосовуються миттєво.

## Деплой на сервер
Див. **[docs/DEPLOY.md](docs/DEPLOY.md)** — Docker + Traefik, webhook, авто-заливка бази знань.

## Корисні команди
| Команда | Призначення |
|---|---|
| `npm run dev` | запустити бота локально |
| `npm run telegram:poll` | локальний міст для Telegram (без публічного URL) |
| `npm run telegram:set-webhook` | підключити прод-вебхук (на сервері) |
| `npm run embeddings:kb` | згенерувати/оновити ембединги записів KB |
| `npm run db:migrate` | застосувати міграції БД |
| `npm run typecheck` | перевірка типів |
