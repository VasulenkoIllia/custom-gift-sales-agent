# workflo_base_ts_integration

Base TypeScript integration template for Workflo projects.

## Includes
- TypeScript
- Docker
- Docker Compose
- Traefik-ready labels
- Adaptive `AGENTS.md` for Claude/Codex workflows

## Structure
- `src/index.ts` — entry point
- `src/lib` — helpers, adapters, clients
- `src/types` — shared types
- `.env.example` — environment variables example
- `docker-compose.yml` — base container setup
- `Dockerfile` — base image definition
- `AGENTS.md` — project operating standard for agents
- `docs/mvp-plan.md` — AI Sales Agent MVP plan (Telegram first)
- `docs/sales-agent-plan.md` — comprehensive implementation plan: 8-stage machine, prompts, KB, eval, phases A-F
- `docs/decisions.md` — key architecture and product decisions
- `docs/integrations.md` — external integrations and requirements
- `docs/database.md` — schema approach for consulting quality and memory

## Deployment naming
This template uses environment-based deployment naming.

Do not rely on `package.json.name` for container or Traefik naming.

Set these values in `.env`:
- `APP_NAME` — deployment, container, and router base name
- `APP_DOMAIN` — public domain for Traefik routing

## Example
```env
APP_NAME=my-project
APP_DOMAIN=api.example.com
```

This will produce:
- container name: `my-project-app`
- Traefik router: `my-project`
- Traefik service: `my-project`

## Run locally
1. Copy `.env.example` to `.env`
2. Update `APP_NAME` and `APP_DOMAIN`
3. Install dependencies
4. Start PostgreSQL in Docker: `docker compose up -d postgres`
5. Run migrations: `npm run db:migrate`
6. Start the app: `npm run dev`
7. For local development without public URL run poll bridge: `npm run telegram:poll`
8. For production/public URL configure Telegram webhook to `POST /webhooks/telegram`

## KeyCRM quick check
1. Set `KEYCRM_API_TOKEN` in `.env`
2. Run `npm run keycrm:products -- --limit=5 --page=1`
3. Run `npm run keycrm:sources` and set `KEYCRM_ORDER_SOURCE_ID` (for order creation)
4. Run full sync: `npm run keycrm:sync`

## AI consultant + vector search
1. Set `OPENAI_API_KEY` in `.env`
2. Build catalog chunks from CRM data: `npm run keycrm:sync`
3. Generate/update embeddings for chunks: `npm run embeddings:catalog`
4. Start app and polling/webhook mode (`npm run dev` + `npm run telegram:poll` for local)

If `OPENAI_API_KEY` is not set, bot still answers with keyword fallback and catalog data.
Prompt and tone can be tuned via `.env`: `AI_AGENT_LANGUAGE`, `AI_AGENT_NAME`, `AI_AGENT_SYSTEM_PROMPT_APPEND`.

## Rebuild catalog chunks (no API calls)
After changing chunk-building logic in `keycrm-sync.ts` or `rebuild-chunks.ts`, regenerate `catalog_chunks` without hitting the KeyCRM API:
```
npm run chunks:rebuild
```
Then re-run `npm run embeddings:catalog` to update vectors.

## Factuality eval
Tests whether the agent hallucinates prices, availability, or product descriptions against real `catalog_chunks`:
```
npm run eval:factuality
```
Set `EVAL_PRODUCT_LIMIT` in `.env` (default: 20). Target: < 1% hallucination rate.

## Followup worker
- Run once: `npm run followups:run`
- Worker sends pending `day_1` and `day_7` followups from DB and writes outbound messages to `messages`.

## Telegram local mode (no public URL)
- Keep API running: `npm run dev`
- Run poll bridge in second terminal: `npm run telegram:poll`
- Poll bridge reads Telegram `getUpdates` and forwards each update to local `POST /webhooks/telegram`.

## Current MVP data model
- `products_raw` — raw KeyCRM product payload mirror
- `products`, `product_offers`, `offer_stocks`, `product_categories` — normalized catalog
- `catalog_chunks`, `catalog_embeddings` — consulting text + vectors
- `customers`, `conversations`, `messages`, `customer_memory` — customer memory and dialog history
- `followups` — follow-up queue (`day_1`, `day_7`)
- `crm_orders`, `integration_events`, `sync_runs` — CRM handoff and sync observability
- `telegram_updates` — deduplication of inbound Telegram webhook events

## Notes
- `package.json.name` is treated as a technical template name
- Real deployment naming should always come from `.env`
- Traefik is expected to use the external `proxy` network by default
