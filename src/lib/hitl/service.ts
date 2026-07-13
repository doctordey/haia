/**
 * HITL service — the domain logic behind the bot dialog and approval.
 * Implements `HitlBotDeps`: routes replies to sessions, computes levels + real
 * lots, persists, and on approval runs the pre-dispatch gates and opens legs.
 */

import type { HitlContext, TargetAccount } from './context';
import type { DialogResult, HitlBotDeps } from './bot';
import { computeLevels, inferDirection, type Direction, type ComputedLevels } from './levels';
import { computeLots } from './sizing';
import { buildLegPlan, preDispatchGates, openLegs, type LegPlan } from './dispatch';
import { isUserAuthorized } from './access';
import { loadTpMultiples } from './targets';
import { loadRiskSettings, loadAccountRiskValues, riskForAccount, type RiskSettings } from './risk';
import { loadExecutionSettings, type ExecutionSettings } from './execution';
import { renderMessage, directionLabel } from './messages';
import type { HitlBroker } from './metaapi';
import type { AlertStrategy as Strategy } from './alert';
import * as session from './session';
import { STATES } from './session';

/** Which strategy a session belongs to (tagged at webhook intake; default Unicorn). */
function sessionStrategy(s: session.HitlSession): Strategy {
  return (s.rawAlert as Record<string, unknown> | null)?.strategy === 'forever' ? 'forever' : 'unicorn';
}

/** A per-account sizing result at confirm/approve time (one armed account). */
interface AccountPlan {
  accountId: string;
  name: string;
  isDemo: boolean;
  broker: HitlBroker;
  equity: number;
  lots: number;
  riskAmount: number;
  riskPctDisplay: number;
  maxRiskPct: number;
  plan: LegPlan;
  signalId: string;   // base signalId for account #0, suffixed for the rest
}

type AccountPlanResult = AccountPlan | { accountId: string; name: string; error: string };
function isPlan(r: AccountPlanResult): r is AccountPlan {
  return !('error' in r);
}

function fmt(n: number | null | undefined, dp = 2): string {
  return n == null ? '—' : n.toFixed(dp);
}

export class HitlService implements HitlBotDeps {
  constructor(private readonly ctx: HitlContext) {}

  isAuthorized(userId: number): Promise<boolean> {
    return isUserAuthorized(this.ctx.cfg, userId);
  }

  getChatIds(): Promise<string[]> {
    return this.ctx.getChatIds();
  }

  async resolveDialogSession(replyToMessageId?: number): Promise<{ id: string; state: string } | undefined> {
    if (replyToMessageId != null) {
      const byReply = await session.findByPromptMessageId(replyToMessageId);
      if (byReply) return { id: byReply.id, state: byReply.state };
    }
    const newest = await session.newestAwaiting();
    return newest ? { id: newest.id, state: newest.state } : undefined;
  }

  async recordPromptMessageIds(sessionId: string, messageIds: number[]): Promise<void> {
    await session.recordPromptMessageIds(sessionId, messageIds);
  }

  /** Opening prompt text for a freshly received alert. */
  async promptText(symbol: string, entry: number | null, direction: string | null, strategy?: string | null): Promise<string> {
    const label = strategy === 'forever' ? 'Forever' : 'Unicorn';
    return renderMessage('prompt', {
      strategy: label,
      direction: await directionLabel(direction),
      symbol,
      price: entry ?? 'market', // Forever entries carry no price — filled from the live quote at confirm
    });
  }

  async submitRange(sessionId: string, a: number, b: number): Promise<DialogResult> {
    const s = await session.getById(sessionId);
    if (!s) return { kind: 'error', text: 'Session not found.' };
    // Forever entries carry no reference price — allowed when the alert already
    // told us the direction (the live quote becomes the entry at confirm).
    if (s.entryRef == null && !s.action) {
      return { kind: 'error', text: 'Session has no entry price.' };
    }

    const rangeHigh = Math.max(a, b);
    const rangeLow = Math.min(a, b);

    const direction: Direction | null =
      (s.action as Direction | null) ??
      (s.entryRef != null ? inferDirection(s.entryRef, rangeHigh, rangeLow) : null);

    if (!direction) {
      await session.transition(sessionId, [STATES.AWAITING_RANGE], STATES.AWAITING_DIRECTION, {
        rangeHigh,
        rangeLow,
        rangeReceivedAt: new Date(),
      });
      return {
        kind: 'need_direction',
        sessionId,
        text: await renderMessage('needDirection', { entry: fmt(s.entryRef), low: fmt(rangeLow), high: fmt(rangeHigh) }),
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

  /**
   * Size + build the leg plan for one armed account (its own equity + risk).
   * Returns an error entry (not a throw) if that account's broker isn't ready,
   * so one bad account never blocks the others.
   */
  private async sizeForAccount(
    acct: TargetAccount,
    symbol: string,
    baseSignalId: string,
    index: number,
    levels: ComputedLevels,
    exec: ExecutionSettings,
    global: RiskSettings,
    overrides: Record<string, number>,
  ): Promise<AccountPlanResult> {
    const name = acct.name ?? acct.accountId;
    const broker = this.ctx.getBroker(acct.accountId);
    if (!broker) return { accountId: acct.accountId, name, error: 'not connected' };

    let spec, equity;
    try {
      await broker.ensureSymbol(symbol);
      spec = broker.getSymbolSpec(symbol);
      equity = broker.getEquity();
    } catch (err) {
      return { accountId: acct.accountId, name, error: err instanceof Error ? err.message : String(err) };
    }

    const rk = riskForAccount(global, overrides[acct.accountId]);
    const sized = computeLots({
      equity,
      riskPct: rk.riskPct,
      maxRiskPct: rk.maxRiskPct,
      entry: levels.entry,
      sl: levels.sl,
      spec,
      riskMode: rk.mode,
      fixedRiskAmount: rk.fixedAmount,
    });
    // Account #0 keeps the base signalId (primary session); the rest get a unique
    // suffix so their session rows and order clientIds don't collide.
    const signalId = index === 0 ? baseSignalId : `${baseSignalId}~a${index}`;
    const effCfg = { ...this.ctx.cfg, positionModel: exec.positionModel };
    const plan = buildLegPlan(signalId, levels, sized.lots, effCfg, spec, { tp3Enabled: exec.tp3Enabled });

    return {
      accountId: acct.accountId,
      name,
      isDemo: acct.isDemo,
      broker,
      equity,
      lots: sized.lots,
      riskAmount: sized.riskAmount,
      riskPctDisplay: equity > 0 ? (sized.riskAmount / equity) * 100 : 0,
      maxRiskPct: rk.maxRiskPct,
      plan,
      signalId,
    };
  }

  private async computeAndConfirm(
    sessionId: string,
    input: { rangeHigh: number; rangeLow: number; direction: Direction },
  ): Promise<DialogResult> {
    const s = await session.getById(sessionId);
    if (!s) return { kind: 'error', text: 'Session not found.' };
    const cfg = this.ctx.cfg;

    const accounts = await this.ctx.resolveTargetAccounts();
    if (accounts.length === 0) {
      return { kind: 'error', text: 'No Unicorn-enabled account is armed/connected. Enable Unicorn on an account in Settings.' };
    }

    // Alerts without a reference price (Forever entries) anchor on the live
    // quote at range time — it's a market entry, so the current price IS the
    // entry. Frozen onto the session for audit + dispatch.
    let entryRef = s.entryRef;
    if (entryRef == null) {
      const broker = this.ctx.getBroker(accounts[0].accountId);
      if (!broker) return { kind: 'error', text: 'Broker not connected yet — try again shortly.' };
      try {
        await broker.ensureSymbol(s.symbol);
      } catch (err) {
        return { kind: 'error', text: `Broker not ready: ${err instanceof Error ? err.message : String(err)}` };
      }
      const quote = broker.getPrice(s.symbol);
      if (!quote) return { kind: 'error', text: `No live quote for ${s.symbol} yet — try again in a few seconds.` };
      entryRef = input.direction === 'BUY' ? quote.ask : quote.bid;
      await session.patch(sessionId, { entryRef });
    }

    const strategy = sessionStrategy(s);
    const tpMultiples = await loadTpMultiples(cfg, strategy);
    const lv = computeLevels({
      entry: entryRef,
      rangeHigh: input.rangeHigh,
      rangeLow: input.rangeLow,
      direction: input.direction,
      tpMultiples,
    });
    if (!lv.ok) return { kind: 'error', text: `Cannot compute levels: ${lv.reason}` };

    const exec = await loadExecutionSettings(cfg, strategy);
    const global = await loadRiskSettings(cfg, strategy);
    const overrides = await loadAccountRiskValues();

    const results = await Promise.all(
      accounts.map((a, i) => this.sizeForAccount(a, s.symbol, s.signalId, i, lv.levels, exec, global, overrides)),
    );
    const plans = results.filter(isPlan);

    if (plans.length === 0) {
      // Every account failed to size — surface why (and symbol suggestions once).
      let text = `No account is ready:\n${results.map((r) => `❌ ${r.name}: ${'error' in r ? r.error : ''}`).join('\n')}`;
      const symErr = results.find((r) => !isPlan(r) && /not available|specification/i.test(r.error));
      if (symErr && this.ctx.suggestSymbols) {
        const matches = await this.ctx.suggestSymbols(s.symbol).catch(() => []);
        if (matches.length > 0) text += `\nDid you mean: ${matches.join(', ')}? Add a mapping in Settings → Unicorn → Symbol mapping.`;
      }
      return { kind: 'error', text };
    }

    // Freeze the shared geometry on the primary session; per-account lots are
    // (re)sized at approve. Store account #0's plan as the representative audit row.
    const primary = plans[0];
    await session.transition(sessionId, [STATES.AWAITING_RANGE, STATES.AWAITING_DIRECTION], STATES.AWAITING_APPROVAL, {
      accountId: primary.accountId,
      direction: input.direction,
      rangeHigh: input.rangeHigh,
      rangeLow: input.rangeLow,
      sl: lv.levels.sl,
      r: lv.levels.r,
      tp1: lv.levels.tp1,
      tp2: lv.levels.tp2,
      tp3: lv.levels.tp3, // always stored for ladder geometry; toggle changes the leg target, not the gate
      lots: primary.lots,
      legs: primary.plan.legs,
      slFrom: 'range_anchored', // audit: SL at protective edge, TPs projected from the far edge
      positionModel: exec.positionModel,
      entryMode: cfg.entryMode,
      riskPct: primary.riskPctDisplay,
      rangeReceivedAt: s.rangeReceivedAt ?? new Date(),
    });

    const perAccount = results
      .map((r) => {
        if (!isPlan(r)) return `⚠️ ${r.name}: unavailable (${r.error}) — will be skipped`;
        const legs = r.plan.legs
          .map((l) => `      • Leg ${l.leg}: ${fmt(l.volume)} → TP ${fmt(l.tp)}`)
          .join('\n');
        const note = r.plan.collapsed ? `\n      ⚠️ ${r.plan.note}` : '';
        return `• ${r.name} (${r.isDemo ? 'DEMO' : 'LIVE'}): ${fmt(r.lots)} lots — risk ${fmt(r.riskPctDisplay)}% (≈ $${fmt(r.riskAmount)})\n${legs}${note}`;
      })
      .join('\n');

    const totalLots = plans.reduce((sum, p) => sum + p.lots, 0);
    const totalRisk = plans.reduce((sum, p) => sum + p.riskAmount, 0);

    const text = await renderMessage('confirm', {
      direction: await directionLabel(input.direction),
      symbol: s.symbol,
      account: plans.length === 1 ? (plans[0].isDemo ? 'DEMO' : 'LIVE') : `${plans.length} accounts`,
      entry: fmt(lv.levels.entry),
      sl: fmt(lv.levels.sl),
      r: fmt(lv.levels.r),
      tp1: fmt(lv.levels.tp1),
      tp2: fmt(lv.levels.tp2),
      tp3: exec.tp3Enabled ? fmt(lv.levels.tp3) : 'off',
      lots: fmt(totalLots),
      risk: fmt(global.mode === 'percent' ? global.riskPct : primary.riskPctDisplay),
      riskAmount: fmt(totalRisk),
      legs: perAccount,
    });

    return { kind: 'confirm', sessionId, text };
  }

  async approve(sessionId: string): Promise<{ ok: boolean; message: string; symbol: string }> {
    // Guarded transition prevents double-dispatch (race / double-tap).
    const s = await session.transition(sessionId, [STATES.AWAITING_APPROVAL], STATES.DISPATCHING, {
      approvedAt: new Date(),
    });
    if (!s) return { ok: false, message: 'Already actioned or expired.', symbol: '' };
    const symbol = s.symbol;

    if (s.entryRef == null || s.sl == null || s.r == null || s.tp1 == null || s.tp2 == null || s.tp3 == null || !s.direction) {
      await session.transition(sessionId, [STATES.DISPATCHING], STATES.FAILED, { failureReason: 'incomplete session at dispatch' });
      return { ok: false, message: 'Session incomplete — cannot dispatch.', symbol };
    }

    const accounts = await this.ctx.resolveTargetAccounts();
    if (accounts.length === 0) {
      await session.transition(sessionId, [STATES.DISPATCHING], STATES.FAILED, { failureReason: 'no armed account at dispatch' });
      return { ok: false, message: 'No Unicorn account is armed/connected — not dispatched.', symbol };
    }

    const direction = s.direction as Direction;
    const levels: ComputedLevels = { direction, entry: s.entryRef, sl: s.sl, r: s.r, tp1: s.tp1, tp2: s.tp2, tp3: s.tp3 };
    const strategy = sessionStrategy(s);
    const exec = await loadExecutionSettings(this.ctx.cfg, strategy);
    const global = await loadRiskSettings(this.ctx.cfg, strategy);
    const overrides = await loadAccountRiskValues();

    const results: { name: string; ok: boolean; message: string }[] = [];
    let anyOk = false;

    // Fan out: mirror the approved trade to every armed account, each sized on its
    // own equity. Account #0 reuses this (primary) session; the rest get children.
    // Each account is isolated so one failure never aborts the others, and the
    // primary session always leaves DISPATCHING (OPEN or FAILED).
    for (let i = 0; i < accounts.length; i++) {
      const acct = accounts[i];
      const failPrimary = (reason: string, extra: Record<string, unknown> = {}) =>
        i === 0 ? session.transition(sessionId, [STATES.DISPATCHING], STATES.FAILED, { failureReason: reason, ...extra }) : Promise.resolve(null);
      try {
        const p = await this.sizeForAccount(acct, symbol, s.signalId, i, levels, exec, global, overrides);

        if (!isPlan(p)) {
          results.push({ name: p.name, ok: false, message: p.error });
          await failPrimary(p.error, { accountId: p.accountId });
          continue;
        }

        const gate = preDispatchGates({
          levels,
          lots: p.lots,
          equity: p.equity,
          spec: p.broker.getSymbolSpec(symbol),
          cfg: this.ctx.cfg,
          isDemo: p.isDemo,
          maxRiskPct: p.maxRiskPct,
        });
        if (!gate.ok) {
          results.push({ name: p.name, ok: false, message: `blocked: ${gate.reason}` });
          await failPrimary(gate.reason, { accountId: p.accountId, lots: p.lots });
          continue;
        }

        const result = await openLegs(p.broker, {
          symbol,
          direction,
          entryMode: this.ctx.cfg.entryMode,
          openPrice: s.entryRef,
          sl: s.sl,
          legs: p.plan.legs,
          slippage: this.ctx.cfg.maxDeviationPoints,
          partialLegFailure: this.ctx.cfg.partialLegFailure,
        });

        const opened = result.status === 'OPEN';
        results.push({ name: p.name, ok: opened, message: opened && result.alert ? `${result.message} ⚠️ partial` : result.message });
        if (opened) anyOk = true;

        if (i === 0 && opened) {
          await session.transition(sessionId, [STATES.DISPATCHING], STATES.OPEN, {
            accountId: p.accountId, lots: p.lots, legs: result.legs, dispatchedAt: new Date(), failureReason: result.alert ?? null,
          });
        } else if (i === 0) {
          await failPrimary(result.message, { accountId: p.accountId, lots: p.lots, legs: result.legs });
        } else if (opened) {
          // Only successful additional accounts need a managed session.
          await session.createDispatched({
            signalId: p.signalId, symbol, accountId: p.accountId, direction,
            entryRef: s.entryRef, sl: s.sl, r: s.r, tp1: s.tp1, tp2: s.tp2, tp3: s.tp3,
            lots: p.lots, legs: result.legs, slFrom: s.slFrom, positionModel: exec.positionModel,
            entryMode: this.ctx.cfg.entryMode, riskPct: p.riskPctDisplay, operatorChatId: s.operatorChatId,
            rawAlert: (s.rawAlert as Record<string, unknown>) ?? {}, state: STATES.OPEN, failureReason: result.alert ?? null,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ name: acct.name ?? acct.accountId, ok: false, message: msg });
        await failPrimary(msg);
      }
    }

    const summary = results.map((r) => `${r.ok ? '✅' : '❌'} ${r.name}: ${r.message}`).join('\n');
    return { ok: anyOk, message: summary, symbol };
  }

  async reject(sessionId: string): Promise<{ message: string; symbol: string }> {
    const s = await session.transition(sessionId, [STATES.AWAITING_APPROVAL], STATES.REJECTED);
    return { message: s ? 'Trade rejected.' : 'Already actioned or expired.', symbol: s?.symbol ?? '' };
  }
}
