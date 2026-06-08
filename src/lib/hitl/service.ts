/**
 * HITL service — the domain logic behind the bot dialog and approval.
 * Implements `HitlBotDeps`: routes replies to sessions, computes levels + real
 * lots, persists, and on approval runs the pre-dispatch gates and opens legs.
 */

import type { HitlContext } from './context';
import type { DialogResult, HitlBotDeps } from './bot';
import { computeLevels, inferDirection, type Direction } from './levels';
import { computeLots } from './sizing';
import { buildLegPlan, preDispatchGates, openLegs } from './dispatch';
import * as session from './session';
import { STATES } from './session';

function fmt(n: number | null | undefined, dp = 2): string {
  return n == null ? '—' : n.toFixed(dp);
}

export class HitlService implements HitlBotDeps {
  constructor(private readonly ctx: HitlContext) {}

  isAuthorized(userId: number): boolean {
    return this.ctx.cfg.authorizedUserIds.includes(userId);
  }

  async resolveDialogSession(
    chatId: string,
    replyToMessageId?: number,
  ): Promise<{ id: string; state: string } | undefined> {
    if (replyToMessageId != null) {
      const byReply = await session.findByPromptMessageId(replyToMessageId);
      if (byReply) return { id: byReply.id, state: byReply.state };
    }
    const newest = await session.newestAwaitingForChat(chatId);
    return newest ? { id: newest.id, state: newest.state } : undefined;
  }

  async recordPromptMessage(sessionId: string, messageId: number): Promise<void> {
    await session.patch(sessionId, { promptMessageId: String(messageId) });
  }

  async recordConfirmMessage(sessionId: string, messageId: number): Promise<void> {
    await session.patch(sessionId, { confirmMessageId: String(messageId) });
  }

  /** Opening prompt text for a freshly received alert. */
  promptText(symbol: string, entry: number | null): string {
    return (
      `🔔 HITL alert: ${symbol} @ ${fmt(entry)}\n` +
      `Reply with the range as two numbers (high low), e.g. \`${fmt(entry ? entry + 10 : 0)} ${fmt(entry ? entry - 10 : 0)}\`.`
    );
  }

  async submitRange(sessionId: string, a: number, b: number): Promise<DialogResult> {
    const s = await session.getById(sessionId);
    if (!s) return { kind: 'error', text: 'Session not found.' };
    if (s.entryRef == null) return { kind: 'error', text: 'Session has no entry price.' };

    const rangeHigh = Math.max(a, b);
    const rangeLow = Math.min(a, b);

    const direction: Direction | null =
      (s.action as Direction | null) ?? inferDirection(s.entryRef, rangeHigh, rangeLow);

    if (!direction) {
      await session.transition(sessionId, [STATES.AWAITING_RANGE], STATES.AWAITING_DIRECTION, {
        rangeHigh,
        rangeLow,
        rangeReceivedAt: new Date(),
      });
      return {
        kind: 'need_direction',
        sessionId,
        text: `Entry ${fmt(s.entryRef)} is inside the range ${fmt(rangeLow)}–${fmt(rangeHigh)}. Reply BUY or SELL.`,
      };
    }

    return this.computeAndConfirm(sessionId, { rangeHigh, rangeLow, direction });
  }

  async submitDirection(sessionId: string, dir: Direction): Promise<DialogResult> {
    const s = await session.getById(sessionId);
    if (!s) return { kind: 'error', text: 'Session not found.' };
    if (s.rangeHigh == null || s.rangeLow == null) {
      return { kind: 'error', text: 'No range on file — reply with the range first.' };
    }
    return this.computeAndConfirm(sessionId, { rangeHigh: s.rangeHigh, rangeLow: s.rangeLow, direction: dir });
  }

  private async computeAndConfirm(
    sessionId: string,
    input: { rangeHigh: number; rangeLow: number; direction: Direction },
  ): Promise<DialogResult> {
    const s = await session.getById(sessionId);
    if (!s || s.entryRef == null) return { kind: 'error', text: 'Session not found.' };
    const cfg = this.ctx.cfg;

    const target = await this.ctx.resolveTargetAccount();
    if (!target) {
      return { kind: 'error', text: 'No HITL-enabled account is armed. Enable HITL on an account in Settings.' };
    }
    const broker = this.ctx.getBroker(target.accountId);
    if (!broker) {
      return { kind: 'error', text: 'Target account is not connected yet — try again shortly.' };
    }

    const lv = computeLevels({
      entry: s.entryRef,
      rangeHigh: input.rangeHigh,
      rangeLow: input.rangeLow,
      direction: input.direction,
      slFrom: cfg.slFrom,
    });
    if (!lv.ok) return { kind: 'error', text: `Cannot compute levels: ${lv.reason}` };

    let spec, equity;
    try {
      spec = broker.getSymbolSpec(s.symbol);
      equity = broker.getEquity();
    } catch (err) {
      return { kind: 'error', text: `Broker not ready: ${err instanceof Error ? err.message : String(err)}` };
    }

    const sized = computeLots({
      equity,
      riskPct: cfg.riskPct,
      maxRiskPct: cfg.maxRiskPerTrade,
      entry: lv.levels.entry,
      sl: lv.levels.sl,
      spec,
    });

    const plan = buildLegPlan(s.signalId, lv.levels, sized.lots, cfg, spec);

    await session.transition(sessionId, [STATES.AWAITING_RANGE, STATES.AWAITING_DIRECTION], STATES.AWAITING_APPROVAL, {
      accountId: target.accountId,
      direction: input.direction,
      rangeHigh: input.rangeHigh,
      rangeLow: input.rangeLow,
      sl: lv.levels.sl,
      r: lv.levels.r,
      tp1: lv.levels.tp1,
      tp2: lv.levels.tp2,
      tp3: lv.levels.tp3,
      lots: sized.lots,
      legs: plan.legs,
      slFrom: cfg.slFrom,
      positionModel: cfg.positionModel,
      entryMode: cfg.entryMode,
      riskPct: cfg.riskPct,
      rangeReceivedAt: s.rangeReceivedAt ?? new Date(),
    });

    const legLines = plan.legs
      .map((l) => `   • Leg ${l.leg}: ${fmt(l.volume)} lots → TP ${fmt(l.tp)}`)
      .join('\n');

    const text =
      `📋 Confirm ${input.direction} ${s.symbol}${target.isDemo ? ' (DEMO)' : ' (LIVE)'}\n` +
      `Entry ${fmt(lv.levels.entry)} | SL ${fmt(lv.levels.sl)} | R ${fmt(lv.levels.r)}\n` +
      `TP1 ${fmt(lv.levels.tp1)} · TP2 ${fmt(lv.levels.tp2)} · TP3 ${fmt(lv.levels.tp3)}\n` +
      `Total ${fmt(sized.lots)} lots (risk ${fmt(cfg.riskPct)}% ≈ $${fmt(sized.riskAmount)})\n` +
      `${legLines}` +
      (plan.collapsed ? `\n⚠️ ${plan.note}` : '');

    return { kind: 'confirm', sessionId, text };
  }

  async approve(sessionId: string): Promise<{ ok: boolean; message: string }> {
    // Guarded transition prevents double-dispatch (race / double-tap).
    const s = await session.transition(sessionId, [STATES.AWAITING_APPROVAL], STATES.DISPATCHING, {
      approvedAt: new Date(),
    });
    if (!s) return { ok: false, message: 'Already actioned or expired.' };

    if (!s.accountId || !s.legs || s.entryRef == null || s.sl == null || !s.direction) {
      await session.transition(sessionId, [STATES.DISPATCHING], STATES.FAILED, { failureReason: 'incomplete session at dispatch' });
      return { ok: false, message: 'Session incomplete — cannot dispatch.' };
    }

    const target = await this.ctx.resolveTargetAccount();
    const broker = this.ctx.getBroker(s.accountId);
    if (!broker || !target) {
      await session.transition(sessionId, [STATES.DISPATCHING], STATES.FAILED, { failureReason: 'broker unavailable at dispatch' });
      return { ok: false, message: 'Broker unavailable — not dispatched.' };
    }

    // Re-run pre-dispatch gates against fresh equity/spec.
    let spec, equity;
    try {
      spec = broker.getSymbolSpec(s.symbol);
      equity = broker.getEquity();
    } catch (err) {
      await session.transition(sessionId, [STATES.DISPATCHING], STATES.FAILED, { failureReason: `broker not ready: ${err}` });
      return { ok: false, message: 'Broker not ready — not dispatched.' };
    }

    const gate = preDispatchGates({
      levels: { direction: s.direction as Direction, entry: s.entryRef, sl: s.sl, r: s.r!, tp1: s.tp1!, tp2: s.tp2!, tp3: s.tp3! },
      lots: s.lots!,
      equity,
      spec,
      cfg: this.ctx.cfg,
      isDemo: broker.isDemo(),
    });
    if (!gate.ok) {
      await session.transition(sessionId, [STATES.DISPATCHING], STATES.FAILED, { failureReason: gate.reason });
      return { ok: false, message: `Blocked by safety gate: ${gate.reason}` };
    }

    const result = await openLegs(broker, {
      symbol: s.symbol,
      direction: s.direction as Direction,
      entryMode: this.ctx.cfg.entryMode,
      openPrice: s.entryRef,
      sl: s.sl,
      legs: s.legs,
      slippage: this.ctx.cfg.maxDeviationPoints,
      partialLegFailure: this.ctx.cfg.partialLegFailure,
    });

    if (result.status === 'OPEN') {
      await session.transition(sessionId, [STATES.DISPATCHING], STATES.OPEN, {
        legs: result.legs,
        dispatchedAt: new Date(),
        failureReason: result.alert ?? null,
      });
      if (result.alert) await this.ctx.notify(result.alert);
      return { ok: true, message: result.message };
    }

    await session.transition(sessionId, [STATES.DISPATCHING], STATES.FAILED, {
      legs: result.legs,
      failureReason: result.message,
    });
    await this.ctx.notify(`❌ HITL dispatch FAILED for ${s.symbol}: ${result.message}`);
    return { ok: false, message: result.message };
  }

  async reject(sessionId: string): Promise<{ message: string }> {
    const s = await session.transition(sessionId, [STATES.AWAITING_APPROVAL], STATES.REJECTED);
    return { message: s ? 'Trade rejected.' : 'Already actioned or expired.' };
  }
}
