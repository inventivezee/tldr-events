// Preflight: validate each configured credential live, and list recent Telegram
// chats so you can find your GROUP's chat id. Prints no secrets.
// Usage: npm run doctor
import "./_env";
import postgres from "postgres";
import Anthropic from "@anthropic-ai/sdk";
import { connectionOptions } from "../src/db/connection";
import { createBrowserSession, browserConfigured } from "../src/lib/browserbase";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function checkDB() {
  const url = process.env.DATABASE_URL;
  if (!url) return line("Database", null, "DATABASE_URL blank — skipped");
  const sql = postgres(url, { ...connectionOptions(url), max: 1 });
  try {
    await sql`select 1`;
    return line("Database", true, "connected + query OK");
  } catch (e) {
    return line("Database", false, msg(e));
  } finally {
    await sql.end();
  }
}

async function checkLLM() {
  const key = process.env.LLM_API_KEY;
  if (!key) return line("LLM (Anthropic)", null, "LLM_API_KEY blank — skipped");
  const model = process.env.SCORING_MODEL || "claude-opus-4-8";
  try {
    const client = new Anthropic({ apiKey: key });
    const r = await client.messages.create({
      model,
      max_tokens: 8,
      messages: [{ role: "user", content: "Reply with just: OK" }],
    });
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("").trim();
    return line("LLM (Anthropic)", true, `${model} → "${text.slice(0, 16)}"`);
  } catch (e) {
    return line("LLM (Anthropic)", false, `${model}: ${msg(e)}`);
  }
}

async function checkBrowserbase() {
  if (!browserConfigured()) return line("Browserbase", null, "not configured — skipped");
  let session;
  try {
    session = await createBrowserSession();
    await session.goto("https://example.com/", { waitMs: 500 });
    const title = await session.page.title();
    return line("Browserbase", true, `session OK, loaded example.com ("${title}")`);
  } catch (e) {
    return line("Browserbase", false, msg(e));
  } finally {
    if (session) await session.close();
  }
}

async function checkTelegram(): Promise<string[]> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return [line("Telegram", null, "TELEGRAM_BOT_TOKEN blank — skipped")];
  const out: string[] = [];
  try {
    const me = await tg(token, "getMe");
    out.push(line("Telegram", true, `bot @${me.username} (id ${me.id})`));
  } catch (e) {
    out.push(line("Telegram", false, `getMe: ${msg(e)}`));
    return out;
  }
  // List recent chats (works only when no webhook is set — fine pre-deploy).
  try {
    const updates: any[] = await tg(token, "getUpdates");
    const chats = new Map<number, string>();
    for (const u of updates) {
      const c = u.message?.chat ?? u.channel_post?.chat ?? u.my_chat_member?.chat;
      if (c) {
        const label = c.title || [c.first_name, c.last_name].filter(Boolean).join(" ") || c.type;
        chats.set(c.id, `${c.type} — ${label}`);
      }
    }
    if (chats.size === 0) {
      out.push("        (no recent chats — add the bot to your group, send a message there, and re-run)");
    } else {
      out.push("        recent chats (use the GROUP id for TELEGRAM_CHANNEL_ID):");
      for (const [id, label] of chats) out.push(`          • ${id}   ${label}`);
    }
  } catch (e) {
    out.push(`        (couldn't list chats: ${msg(e)} — if a webhook is set, delete it first)`);
  }
  return out;
}

async function tg(token: string, method: string): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`);
  const json = (await res.json()) as { ok: boolean; result?: any; description?: string };
  if (!json.ok) throw new Error(json.description || `${method} failed`);
  return json.result;
}

function line(name: string, ok: boolean | null, note: string): string {
  const mark = ok === null ? "–" : ok ? "✓" : "✗";
  return `  ${mark}  ${name.padEnd(18)} ${note}`;
}

async function main() {
  console.log("TLDR Events — credential preflight\n");
  const [db, llm, bb] = await Promise.all([checkDB(), checkLLM(), checkBrowserbase()]);
  const tgLines = await checkTelegram();
  console.log(db);
  console.log(llm);
  console.log(bb);
  for (const l of tgLines) console.log(l);
  console.log("\n(✓ ok · ✗ failed · – skipped/not configured)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
