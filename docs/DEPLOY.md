# Деплой на сервер (Docker + Traefik)

Бот працює як 2 контейнери: `app` (Node) + `postgres` (pgvector). У проді Telegram доставляє повідомлення через **webhook** (не polling). База знань заливається автоматично при першому старті Postgres із `db/init/`.

## Передумови на сервері
- Docker + docker compose.
- Працює Traefik із зовнішньою мережею (за замовч. `proxy`) і entrypoint `websecure` (TLS).
- DNS: A-запис `APP_DOMAIN` → IP сервера.

## Кроки

**1. Клон + env**
```bash
git clone git@github.com:VasulenkoIllia/custom-gift-sales-agent.git && cd custom-gift-sales-agent
cp .env.deploy .env            # .env.deploy НЕ в git — перенесіть його на сервер окремо (scp)
nano .env                      # змініть APP_DOMAIN (і TRAEFIK_* якщо інші)
```

**2. Запуск**
```bash
docker compose up -d --build
docker compose logs -f app     # дочекайтесь "listening on port 3000"
```
При першому старті Postgres сам виконає `db/init/01_schema.sql` + `02_seed.sql` →
схема + **133 записи KB з ембедингами** + конфіг агента. Нічого ембедити заново не треба.

**3. Перевірка**
```bash
curl -fsS https://APP_DOMAIN/health        # {"status":"ok"}
curl -u admin:ПАРОЛЬ https://APP_DOMAIN/admin/api/meta   # категорії → адмінка жива
```

**4. Підключити Telegram webhook (один раз)**
```bash
docker compose exec app npm run telegram:set-webhook
# читає APP_DOMAIN + TELEGRAM_WEBHOOK_SECRET з env, ставить https://APP_DOMAIN/webhooks/telegram
```
Перевірка: у виводі `getWebhookInfo` має бути ваш URL і `pending_update_count`.

**5. Готово**
- Бот відповідає всім у Telegram (**@cug_asistant_bot**).
- Адмінка: `https://APP_DOMAIN/admin` (Basic auth: `ADMIN_USER`/`ADMIN_PASSWORD`).

## Оновлення коду
```bash
git pull && docker compose up -d --build
```

## Оновлення / редагування бази знань
Через адмінку `/admin` (додати/редагувати → «🔄 Оновити пошук»). Зміни застосовуються миттєво.

## Майбутні зміни схеми БД
initdb виконується лише на ПОРОЖНІЙ БД. Для нових змін додайте `db/migrations/012_*.sql` і:
```bash
docker compose exec app npm run db:migrate
```
(001–011 вже позначені застосованими в `02_seed.sql`, тож повторно не виконуються.)

## Бекап бази знань
```bash
docker compose exec postgres pg_dump -U app_user -d app_db --data-only -t kb_entries -t agents > kb_backup_$(date +%F).sql
```

## Якщо треба повернутись на локальний polling
```bash
docker compose exec app npm run telegram:set-webhook -- --delete
npm run telegram:poll   # локально
```

## Типові проблеми

**`port is already allocated` для postgres**
На сервері такого більше не буде: Postgres **не публікує хост-порт** — додаток ходить до нього лише по внутрішній мережі (`postgres:5432`). База повністю ізольована й не конфліктує з іншими Postgres на хості. Для psql/бекапу: `docker compose exec postgres psql -U app_user -d app_db`.

**Бот мовчить у Telegram**
- Перевірте вебхук: `docker compose exec app npm run telegram:set-webhook` → у `getWebhookInfo` має бути ваш URL без `last_error_message`.
- `docker compose logs -f app` — чи приходять апдейти.
- Переконайтесь, що `TELEGRAM_WEBHOOK_SECRET` у `.env` збігається (сервер перевіряє заголовок).

**502 / "Bad Gateway" від Traefik**
- `docker compose ps` — контейнер `app` має бути `healthy`.
- Перевірте, що `APP_NAME`, `APP_DOMAIN`, `TRAEFIK_*` у `.env` коректні та домен у тій самій мережі `proxy`.

**Сертифікат не видається (HTTPS не працює)**
- A-запис `APP_DOMAIN` має вказувати на сервер ДО старту.
- `TRAEFIK_CERTRESOLVER` має збігатися з вашим (у прикладі `cf`).

**База знань порожня після старту**
initdb (`db/init/`) виконується лише на ПОРОЖНІЙ БД. Якщо том `postgres-data` уже існував — схема/дані не перезаливались. Для чистого старту: `docker compose down -v` (⚠️ видаляє дані) і знову `up -d`.
