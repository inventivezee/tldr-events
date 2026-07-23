// Telegram Bot API client (PRD §12, Appendix B). Thin fetch wrapper; HTML parse
// mode; handles the supergroup→channel migrate_to_chat_id case.
import { logger } from "@/lib/logger";

const log = logger("telegram");

export interface InlineButton {
  text: string;
  url: string;
}

function token(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return t;
}

export function telegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN?.trim();
}

async function call<T = any>(method: string, params: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  const json = (await res.json()) as {
    ok: boolean;
    result?: T;
    description?: string;
    parameters?: { migrate_to_chat_id?: number; retry_after?: number };
  };
  if (!json.ok) {
    const err = new Error(`Telegram ${method} failed: ${json.description}`) as Error & {
      parameters?: { migrate_to_chat_id?: number; retry_after?: number };
    };
    err.parameters = json.parameters;
    throw err;
  }
  return json.result as T;
}

export interface SendResult {
  messageId: number;
  /** Present when the channel migrated to a new (supergroup) chat id. */
  migratedChatId?: number;
}

/** Send an HTML message with an optional inline keyboard (one button per row). */
export async function sendMessage(
  chatId: string | number,
  html: string,
  buttons?: InlineButton[],
): Promise<SendResult> {
  const params: Record<string, unknown> = {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (buttons && buttons.length) {
    params.reply_markup = {
      inline_keyboard: buttons.map((b) => [{ text: b.text, url: b.url }]),
    };
  }
  try {
    const msg = await call<{ message_id: number }>("sendMessage", params);
    return { messageId: msg.message_id };
  } catch (e) {
    const p = (e as { parameters?: { migrate_to_chat_id?: number; retry_after?: number } })
      .parameters;
    if (p?.migrate_to_chat_id) {
      log.warn(`chat migrated → ${p.migrate_to_chat_id}; retrying`);
      const msg = await call<{ message_id: number }>("sendMessage", {
        ...params,
        chat_id: p.migrate_to_chat_id,
      });
      return { messageId: msg.message_id, migratedChatId: p.migrate_to_chat_id };
    }
    if (p?.retry_after) {
      await new Promise((r) => setTimeout(r, (p.retry_after! + 1) * 1000));
      const msg = await call<{ message_id: number }>("sendMessage", params);
      return { messageId: msg.message_id };
    }
    throw e;
  }
}

export async function setWebhook(url: string, secretToken: string): Promise<void> {
  await call("setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: ["message", "channel_post"],
  });
}

export async function deleteWebhook(): Promise<void> {
  await call("deleteWebhook", { drop_pending_updates: false });
}

export async function getMe(): Promise<{ id: number; username: string }> {
  return call("getMe", {});
}

export function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
