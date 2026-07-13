/**
 * Direct Telegram send for the web process.
 *
 * The grammy bot lives in the signal-listener worker — a Next.js route can't
 * reach it (separate OS process, no shared globalThis). For webhook-driven
 * notifications (e.g. Forever "ERL Hit" forwards) the route calls the Bot API
 * over HTTPS itself, fanning out to the same destinations the bot uses.
 */

import type { HitlConfig } from './config';
import { loadChatIds } from './access';

export async function sendOperatorMessage(cfg: HitlConfig, text: string): Promise<number> {
  if (!cfg.telegramBotToken) return 0;
  const chatIds = await loadChatIds(cfg);
  let sent = 0;
  for (const chatId of chatIds) {
    try {
      // Bounded per send — this is awaited by the webhook route, so a hung
      // Telegram API must not hang the request.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`https://api.telegram.org/bot${cfg.telegramBotToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
      if (res.ok) sent++;
      else console.warn(`[hitl/notify] sendMessage to ${chatId} failed: HTTP ${res.status}`);
    } catch (err) {
      console.warn(`[hitl/notify] sendMessage to ${chatId} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return sent;
}
