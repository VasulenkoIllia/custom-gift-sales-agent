# Deployment

Use this file to document how the project is built, configured, and deployed.

## Capture
- runtime environment
- required env vars
- docker and compose notes
- Traefik routing and domain setup
- healthcheck behavior
- startup order requirements
- migration or bootstrap steps
- rollback notes
- server-specific assumptions

## Suggested template
### Environment
- Runtime:
- Node version:
- Container image:

### Required environment variables
- APP_NAME:
- APP_DOMAIN:
- PORT:
- NODE_ENV:
- TZ:
- LOG_LEVEL:
- DATABASE_URL:
- POSTGRES_DB:
- POSTGRES_USER:
- POSTGRES_PASSWORD:
- POSTGRES_PORT:
- KEYCRM_BASE_URL:
- KEYCRM_API_TOKEN:
- KEYCRM_TIMEOUT_MS:
- KEYCRM_ORDER_SOURCE_ID:
- TELEGRAM_BOT_TOKEN:
- TELEGRAM_WEBHOOK_SECRET:
- TELEGRAM_API_BASE_URL:
- TELEGRAM_TIMEOUT_MS:
- FOLLOWUP_BATCH_SIZE:

### Reverse proxy / Traefik
- Network:
- EntryPoint:
- TLS:
- Certresolver:

### Startup notes
- Build command:
- Start command:
- Healthcheck:
- Dependencies:
- Migration command: `npm run db:migrate`
- Catalog sync command: `npm run keycrm:sync`
- Order sources command: `npm run keycrm:sources`
- Followup worker command: `npm run followups:run`

### Rollback notes
- Previous image / tag:
- Config changes to review:
- Data or migration risk:
