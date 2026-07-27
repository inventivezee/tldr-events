import "./_env";
const T = process.env.TELEGRAM_BOT_TOKEN!;
async function api(m: string) {
  const r = await fetch(`https://api.telegram.org/bot${T}/${m}`);
  return r.json();
}
const me = await api("getMe");
console.log("BOT:", JSON.stringify({
  username: me.result?.username,
  can_read_all_group_messages: me.result?.can_read_all_group_messages,
  can_join_groups: me.result?.can_join_groups,
}, null, 2));
const wh = await api("getWebhookInfo");
const w = wh.result ?? {};
console.log("WEBHOOK:", JSON.stringify({
  url: (w.url || "").replace(/\/[^/]*$/, "/…"),
  pending_update_count: w.pending_update_count,
  last_error_date: w.last_error_date ? new Date(w.last_error_date*1000).toISOString() : null,
  last_error_message: w.last_error_message,
  max_connections: w.max_connections,
  allowed_updates: w.allowed_updates,
}, null, 2));
