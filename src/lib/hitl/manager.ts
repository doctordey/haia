/**
 * HITL manager loop — the periodic safety + lifecycle engine. Runs inside the
 * signal-listener worker on an interval (and once on boot for resume):
 *
 *  • prompt newly RECEIVED sessions
 *  • timeout sweep: pre-fill sessions past SIGNAL_TIMEOUT_SECONDS → EXPIRED
 *  • breakeven backstop: webhook flag and/or price reaching TP1 → SL=entry once
 *  • close detection: positions gone → CLOSED (+ realized P/L if available)
 *  • resume-on-restart: reconcile every non-terminal session against live state
 *
 * All MetaApi reads go through the injected broker (one wrapper invariant).
 */

import type { HitlContext } from './context';
import type { HitlBot } from './bot';
import type { HitlService } from './service';
import type { Direction } from './levels';
import type { HitlBroker } from './metaapi';
import * as session from './session';
import { STATES, PRE_FILL_STATES, type HitlSession } from './session';

const CLOSE_GRACE_MS = 15_000; // ignore "no positions" right after dispatch

export class HitlManager {
  private timer: NodeJS.Timeout | null = null;
  // Sessions we've already DM'd about a BE issue, so we don't repeat every tick.
  private beAlerted = new Set<string>();

  constructor(
    private readonly ctx: HitlContext,
    private readonly bot: HitlBot,
    private readonly service: HitlService,
  ) {}

  /** One full pass. Each task is isolated so one failure doesn't stall the rest. */
  async tick(): Promise<void> {
    await this.safely('promptNewSessions', () => this.promptNewSessions());
    await this.safely('timeoutSweep', () => this.timeoutSweep());
    await this.safely('breakevenBackstop', () => this.breakevenBackstop());
    await this.safely('closeDetection', () => this.closeDetection());
  }

  start(intervalMs = 5_000): void {
    if (this.timer) return;
    const loop = async () => {
      await this.tick().catch((err) => console.error('[hitl/manager] tick error:', err));
    };
    this.timer = setInterval(loop, intervalMs);
    console.log(`[hitl/manager] loop started (${intervalMs}ms)`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ── tasks ──────────────────────────────────────────

  private async promptNewSessions(): Promise<void> {
    const rows = await session.listByState([STATES.RECEIVED]);
    for (const s of rows) {
      const claimed = await session.transition(s.id, [STATES.RECEIVED], STATES.AWAITING_RANGE);
      if (!claimed) continue; // someone else handled it
      try {
        await this.bot.sendPrompt(s.id, this.service.promptText(s.symbol, s.entryRef));
      } catch (err) {
        console.error(`[hitl/manager] prompt send failed for ${s.id}:`, err);
      }
    }
  }

  private async timeoutSweep(): Promise<void> {
    const cutoff = Date.now() - this.ctx.cfg.signalTimeoutSeconds * 1000;
    const rows = await session.listByState(PRE_FILL_STATES);
    for (const s of rows) {
      if (s.receivedAt.getTime() >= cutoff) continue;
      const expired = await session.transition(s.id, PRE_FILL_STATES, STATES.EXPIRED, {
        failureReason: 'pre-fill timeout',
      });
      if (expired) {
        await this.ctx.notify(`⏱️ HITL ${s.symbol} expired (no approval within ${this.ctx.cfg.signalTimeoutSeconds}s).`);
      }
    }
  }

  private beShouldFire(s: HitlSession, broker: HitlBroker): boolean {
    const trigger = this.ctx.cfg.beTrigger;
    const webhookHit = s.beRequested;
    let priceHit = false;
    if (trigger !== 'webhook' && s.tp1 != null) {
      const price = broker.getPrice(s.symbol);
      if (price) {
        priceHit = s.direction === 'BUY' ? price.bid >= s.tp1 : price.ask <= s.tp1;
      }
    }
    if (trigger === 'webhook') return webhookHit;
    if (trigger === 'internal') return priceHit;
    return webhookHit || priceHit; // both
  }

  private async breakevenBackstop(): Promise<void> {
    const rows = await session.listByState([STATES.OPEN]);
    for (const s of rows) {
      if (s.beApplied || s.accountId == null || s.entryRef == null || !s.direction) continue;
      const broker = this.ctx.getBroker(s.accountId);
      if (!broker) continue;
      if (!this.beShouldFire(s, broker)) continue;

      // The stop can only move to entry when the trade is in profit (entry on the
      // protective side of the live price); otherwise the broker would reject it.
      const price = broker.getPrice(s.symbol);
      if (!price) continue; // no quote yet — retry next tick
      const valid = s.direction === 'BUY' ? s.entryRef < price.bid : s.entryRef > price.ask;
      if (!valid) {
        if (!this.beAlerted.has(s.id)) {
          this.beAlerted.add(s.id);
          await this.ctx.notify(
            `⚠️ HITL ${s.symbol}: breakeven was triggered, but the trade isn't in profit yet — ` +
            `the stop can't move to entry until price reaches TP1. I'll apply it automatically when it does.`,
          );
        }
        continue;
      }

      // Claim first (exactly-once), then move; revert the claim if the move fails.
      const claimed = await session.claimBreakeven(s.id);
      if (!claimed) continue;

      try {
        const positions = broker.positionsBySignal(s.signalId);
        for (const pos of positions) {
          await broker.modifySl(pos.id, s.entryRef, pos.takeProfit ?? undefined);
        }
        this.beAlerted.delete(s.id);
        await this.ctx.notify(`🟦 HITL ${s.symbol}: TP1 reached — stop moved to breakeven (${positions.length} leg(s)).`);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[hitl/manager] BE move failed for ${s.id}, reverting claim:`, reason);
        await session.patch(s.id, { beApplied: false, beAppliedAt: null });
        if (!this.beAlerted.has(s.id)) {
          this.beAlerted.add(s.id);
          await this.ctx.notify(`⚠️ HITL ${s.symbol}: breakeven move was rejected — ${reason}. Will retry.`);
        }
      }
    }
  }

  private async closeDetection(): Promise<void> {
    const rows = await session.listByState([STATES.OPEN]);
    for (const s of rows) {
      if (s.accountId == null || s.dispatchedAt == null) continue;
      if (Date.now() - s.dispatchedAt.getTime() < CLOSE_GRACE_MS) continue;
      const broker = this.ctx.getBroker(s.accountId);
      if (!broker) continue;

      const positions = broker.positionsBySignal(s.signalId);
      if (positions.length > 0) continue;

      let realizedPnl: number | null = null;
      if (this.ctx.realizedPnlForSignal) {
        realizedPnl = await this.ctx.realizedPnlForSignal(s.signalId, s.dispatchedAt).catch(() => null);
      }
      const closed = await session.transition(s.id, [STATES.OPEN], STATES.CLOSED, {
        closedAt: new Date(),
        realizedPnl,
      });
      if (closed) {
        const pnl = realizedPnl == null ? '' : ` P/L ${realizedPnl >= 0 ? '+' : ''}${realizedPnl.toFixed(2)}`;
        await this.ctx.notify(`✅ HITL ${s.symbol} closed.${pnl}`);
      }
    }
  }

  // ── boot-time reconciliation ───────────────────────

  async resumeOnRestart(): Promise<void> {
    const rows = await session.listByState(session.ACTIVE_STATES);
    const cutoff = Date.now() - this.ctx.cfg.signalTimeoutSeconds * 1000;
    let resumed = 0;

    for (const s of rows) {
      // Pre-fill past timeout → expire.
      if (PRE_FILL_STATES.includes(s.state as (typeof PRE_FILL_STATES)[number])) {
        if (s.receivedAt.getTime() < cutoff) {
          await session.transition(s.id, PRE_FILL_STATES, STATES.EXPIRED, { failureReason: 'pre-fill timeout (restart)' });
        }
        continue;
      }

      // OPEN / DISPATCHING → reconcile against live positions.
      if (s.accountId == null) continue;
      const broker = this.ctx.getBroker(s.accountId);
      if (!broker) continue; // connection not up yet — leave for the loop

      const positions = broker.positionsBySignal(s.signalId);

      if (s.state === STATES.DISPATCHING) {
        if (positions.length > 0) {
          await session.transition(s.id, [STATES.DISPATCHING], STATES.OPEN, { dispatchedAt: s.dispatchedAt ?? new Date() });
        } else {
          await session.transition(s.id, [STATES.DISPATCHING], STATES.FAILED, { failureReason: 'no positions found on restart' });
        }
        continue;
      }

      if (s.state === STATES.OPEN && positions.length === 0 && s.dispatchedAt != null) {
        await session.transition(s.id, [STATES.OPEN], STATES.CLOSED, { closedAt: new Date() });
      }
      resumed++;
    }

    console.log(`[hitl/manager] resume reconciled ${rows.length} session(s), ${resumed} still active`);
  }

  // ── util ───────────────────────────────────────────

  private async safely(label: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      console.error(`[hitl/manager] ${label} failed:`, err);
    }
  }
}

// Re-export for callers that want the direction type alongside the manager.
export type { Direction };
