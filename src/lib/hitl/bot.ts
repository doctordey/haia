/**
 * HITL Telegram bot (grammy) — the operator dialog.
 *
 * Flow: prompt → operator replies with the range → (if entry is inside the
 * range) ask direction → confirm card with real lots → Approve/Reject buttons.
 * Authorization is re-checked on BOTH the text reply and the button callback
 * (not just at prompt time).
 *
 * Telegram-specific parsing/rendering lives here; all domain logic (compute,
 * persist, dispatch) is injected via `HitlBotDeps`, implemented by the worker.
 */

import { Bot, InlineKeyboard } from 'grammy';

export type DialogResultKind = 'need_direction' | 'confirm' | 'error' | 'ack';

export interface DialogResult {
  kind: DialogResultKind;
  text: string;
  sessionId?: string;   // set for 'confirm' so the buttons can carry it
}

export interface HitlBotDeps {
  isAuthorized(userId: number): Promise<boolean>;
  /** Find which session a text message belongs to (reply target → fallback to newest awaiting). */
  resolveDialogSession(
    chatId: string,
    replyToMessageId?: number,
  ): Promise<{ id: string; state: string } | undefined>;
  submitRange(sessionId: string, a: number, b: number): Promise<DialogResult>;
  submitDirection(sessionId: string, dir: 'BUY' | 'SELL'): Promise<DialogResult>;
  approve(sessionId: string): Promise<{ ok: boolean; message: string }>;
  reject(sessionId: string): Promise<{ message: string }>;
  recordPromptMessage(sessionId: string, messageId: number): Promise<void>;
  recordConfirmMessage(sessionId: string, messageId: number): Promise<void>;
}

const NUMBER_RE = /-?\d+(?:\.\d+)?/g;

function parseTwoNumbers(text: string): [number, number] | null {
  const matches = text.match(NUMBER_RE);
  if (!matches || matches.length < 2) return null;
  return [Number(matches[0]), Number(matches[1])];
}

function parseDirection(text: string): 'BUY' | 'SELL' | null {
  if (/\b(buy|long)\b/i.test(text)) return 'BUY';
  if (/\b(sell|short)\b/i.test(text)) return 'SELL';
  return null;
}

function approvalKeyboard(sessionId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Approve', `a:${sessionId}`)
    .text('❌ Reject', `r:${sessionId}`);
}

export class HitlBot {
  private readonly bot: Bot;

  constructor(token: string, private readonly deps: HitlBotDeps) {
    this.bot = new Bot(token);
    this.registerHandlers();
  }

  private registerHandlers(): void {
    this.bot.on('message:text', async (ctx) => {
      const userId = ctx.from?.id;
      const chatId = ctx.chat?.id;
      if (userId == null || chatId == null) return;

      if (!(await this.deps.isAuthorized(userId))) {
        console.warn(`[hitl/bot] ignoring message from unauthorized user ${userId}`);
        return; // silent: ignore + log (acceptance requirement)
      }

      const session = await this.deps.resolveDialogSession(
        String(chatId),
        ctx.message.reply_to_message?.message_id,
      );
      if (!session) return; // not part of a dialog

      const text = ctx.message.text.trim();
      let result: DialogResult;

      if (session.state === 'AWAITING_DIRECTION') {
        const dir = parseDirection(text);
        if (!dir) {
          await ctx.reply('Please reply BUY or SELL.');
          return;
        }
        result = await this.deps.submitDirection(session.id, dir);
      } else if (session.state === 'AWAITING_RANGE') {
        const nums = parseTwoNumbers(text);
        if (!nums) {
          await ctx.reply('Please reply with the range as two numbers, e.g. `5010 4990`.');
          return;
        }
        result = await this.deps.submitRange(session.id, nums[0], nums[1]);
      } else {
        return; // not awaiting input
      }

      await this.renderResult(ctx, result);
    });

    this.bot.on('callback_query:data', async (ctx) => {
      const userId = ctx.from?.id;
      const data = ctx.callbackQuery.data;
      const [action, sessionId] = data.split(':');

      if (userId == null || !(await this.deps.isAuthorized(userId))) {
        await ctx.answerCallbackQuery({ text: 'Not authorized', show_alert: true }).catch(() => {});
        console.warn(`[hitl/bot] ignoring callback from unauthorized user ${userId}`);
        return;
      }
      if (!sessionId) {
        await ctx.answerCallbackQuery().catch(() => {});
        return;
      }

      if (action === 'a') {
        await ctx.answerCallbackQuery({ text: 'Approving…' }).catch(() => {});
        const res = await this.deps.approve(sessionId);
        await ctx.editMessageText(`${res.ok ? '✅ Approved' : '⚠️ Approval failed'}\n${res.message}`).catch(() => {});
      } else if (action === 'r') {
        await ctx.answerCallbackQuery({ text: 'Rejected' }).catch(() => {});
        const res = await this.deps.reject(sessionId);
        await ctx.editMessageText(`❌ Rejected\n${res.message}`).catch(() => {});
      } else {
        await ctx.answerCallbackQuery().catch(() => {});
      }
    });

    this.bot.catch((err) => {
      console.error('[hitl/bot] handler error:', err.error);
    });
  }

  private async renderResult(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ctx: any,
    result: DialogResult,
  ): Promise<void> {
    if (result.kind === 'confirm' && result.sessionId) {
      const sent = await ctx.reply(result.text, { reply_markup: approvalKeyboard(result.sessionId) });
      await this.deps.recordConfirmMessage(result.sessionId, sent.message_id);
    } else if (result.kind === 'need_direction') {
      const sent = await ctx.reply(result.text);
      // Route the next reply: re-point the prompt message id at this question.
      if (result.sessionId) await this.deps.recordPromptMessage(result.sessionId, sent.message_id);
    } else {
      await ctx.reply(result.text);
    }
  }

  /** Send the opening prompt for a new session; records the message id for reply routing. */
  async sendPrompt(chatId: string, sessionId: string, text: string): Promise<void> {
    const sent = await this.bot.api.sendMessage(chatId, text);
    await this.deps.recordPromptMessage(sessionId, sent.message_id);
  }

  /** Fire-and-forget operator notification. */
  async notify(chatId: string, text: string): Promise<void> {
    await this.bot.api.sendMessage(chatId, text).catch((err) => {
      console.error('[hitl/bot] notify failed:', err);
    });
  }

  /** Start long-polling (no inbound port). Non-blocking. */
  start(): void {
    // grammy's start() resolves only when the bot stops; run it detached.
    void this.bot.start({ onStart: () => console.log('[hitl/bot] long-polling started') });
  }

  async stop(): Promise<void> {
    await this.bot.stop();
  }
}
