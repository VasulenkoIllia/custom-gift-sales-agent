/**
 * telegram-set-webhook.ts — Point the Telegram bot at the production webhook.
 *
 *   npm run telegram:set-webhook
 *
 * Reads TELEGRAM_BOT_TOKEN, APP_DOMAIN, TELEGRAM_WEBHOOK_SECRET from env.
 * Run once after the server is up and reachable over HTTPS at APP_DOMAIN.
 * Use `--delete` to remove the webhook (e.g. to switch back to local polling).
 */

const token = process.env.TELEGRAM_BOT_TOKEN;
const domain = process.env.APP_DOMAIN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
const base = process.env.TELEGRAM_API_BASE_URL || "https://api.telegram.org";

if (!token) {
    console.error("ERROR: TELEGRAM_BOT_TOKEN is not set.");
    process.exit(1);
}

async function main(): Promise<void> {
    const wantDelete = process.argv.includes("--delete");

    if (wantDelete) {
        const res = await fetch(`${base}/bot${token}/deleteWebhook`, { method: "POST" });
        console.log("deleteWebhook:", await res.text());
        return;
    }

    if (!domain) {
        console.error("ERROR: APP_DOMAIN is not set (need it to build the webhook URL).");
        process.exit(1);
    }

    const url = `https://${domain}/webhooks/telegram`;
    const res = await fetch(`${base}/bot${token}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            url,
            secret_token: secret || undefined,
            allowed_updates: ["message"],
            drop_pending_updates: true,
        }),
    });
    const body = await res.json();
    console.log(`setWebhook → ${url}`);
    console.log(JSON.stringify(body, null, 2));

    const info = (await fetch(`${base}/bot${token}/getWebhookInfo`).then((r) => r.json())) as {
        result?: unknown;
    };
    console.log("getWebhookInfo:", JSON.stringify(info.result, null, 2));
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
