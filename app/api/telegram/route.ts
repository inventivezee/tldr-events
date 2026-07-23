// Telegram bot webhook (PRD §12.2). Validates the secret-token header Telegram
// echoes back, then dispatches to the command handler. No polling.
import { NextRequest, NextResponse } from "next/server";
import { handleUpdate } from "@/telegram/bot";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = logger("tg-webhook");

export async function POST(req: NextRequest) {
  // Fail closed: the webhook must always be protected. A missing secret means
  // misconfiguration, not "open to everyone".
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const header = req.headers.get("x-telegram-bot-api-secret-token");
  if (!secret || header !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: unknown;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  try {
    await handleUpdate(update as never);
  } catch (e) {
    // Always 200 so Telegram doesn't retry-storm on a handler bug.
    log.error("handleUpdate failed", e);
  }
  return NextResponse.json({ ok: true });
}
