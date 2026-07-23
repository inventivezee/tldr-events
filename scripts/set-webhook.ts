// Register (or delete) the Telegram bot webhook (PRD §12.2).
// Usage:
//   npm run tg:set-webhook            # sets webhook to $NEXT_PUBLIC_SITE_URL/api/telegram
//   npm run tg:set-webhook -- delete  # removes the webhook
import "./_env";
import { setWebhook, deleteWebhook, getMe, telegramConfigured } from "../src/telegram/api";

async function main() {
  if (!telegramConfigured()) {
    console.error("TELEGRAM_BOT_TOKEN not set.");
    process.exit(1);
  }
  const me = await getMe();
  console.log(`Bot: @${me.username} (id ${me.id})`);

  if (process.argv.includes("delete")) {
    await deleteWebhook();
    console.log("Webhook deleted.");
    return;
  }

  const site = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!site || site.startsWith("http://localhost")) {
    console.error(
      `NEXT_PUBLIC_SITE_URL must be your public https URL (got '${site || "unset"}'). ` +
        "Set it after deploying to Vercel, then re-run.",
    );
    process.exit(1);
  }
  if (!secret) {
    console.error("TELEGRAM_WEBHOOK_SECRET not set.");
    process.exit(1);
  }
  const url = `${site}/api/telegram`;
  await setWebhook(url, secret);
  console.log(`Webhook set → ${url}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
