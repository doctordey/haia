/**
 * HITL dispatch — turn an approved session into live orders.
 *
 * Two responsibilities:
 *  1. `buildLegPlan` — pure: decide the leg volumes + TP assignment (Leg A→TP2,
 *     Leg B→TP3; collapse to a single front-loaded leg→TP3 when too small, or
 *     a single position in POSITION_MODEL=single). The bot uses this to render
 *     the confirm card and persists it on the session.
 *  2. `openLegs` — open each leg fail-closed. Per PARTIAL_LEG_FAILURE: if one
 *     leg fills and another errors, `alert_hold` keeps the filled leg open and
 *     alerts; `auto_close` closes the filled leg and fails the session.
 */

import type { HitlConfig } from './config';
import type { ComputedLevels } from './levels';
import type { HitlBroker } from './metaapi';
import { clientIdFor } from './metaapi';
import { splitLegs, valuePerPoint, type HitlSymbolSpec } from './sizing';
import type { HitlLeg } from '@/lib/db/schema';

export interface LegPlan {
  legs: HitlLeg[];
  collapsed: boolean;
  note?: string;
}

/** Pure: produce the pending leg plan (volumes, TPs, clientIds) for a signal. */
export function buildLegPlan(
  signalId: string,
  levels: ComputedLevels,
  lots: number,
  cfg: HitlConfig,
  spec: HitlSymbolSpec,
): LegPlan {
  const mk = (leg: 'A' | 'B', volume: number, tp: number): HitlLeg => ({
    leg,
    tp,
    volume,
    clientId: clientIdFor(signalId, leg),
    ticket: null,
    status: 'pending',
  });

  // Single-position model: one position straight to TP3.
  if (cfg.positionModel === 'single') {
    return { legs: [mk('A', lots, levels.tp3)], collapsed: false, note: 'single-position model → TP3' };
  }

  const split = splitLegs(lots, cfg.legSplit, spec);
  if (split.collapsed) {
    return { legs: [mk('A', split.legs[0].volume, levels.tp3)], collapsed: true, note: split.reason };
  }

  const legA = split.legs.find((l) => l.leg === 'A')!;
  const legB = split.legs.find((l) => l.leg === 'B')!;
  return {
    legs: [mk('A', legA.volume, levels.tp2), mk('B', legB.volume, levels.tp3)],
    collapsed: false,
  };
}

export interface GateInput {
  levels: ComputedLevels;
  lots: number;
  equity: number;
  spec: HitlSymbolSpec;
  cfg: HitlConfig;
  isDemo: boolean;
}

export type GateResult = { ok: true } | { ok: false; reason: string };

/** Pre-dispatch safety gates. Any failure aborts before a single order is sent. */
export function preDispatchGates(input: GateInput): GateResult {
  const { levels, lots, equity, spec, cfg, isDemo } = input;
  const { direction, entry, sl, r, tp1, tp2, tp3 } = levels;

  // Demo-only until acceptance passes.
  if (!isDemo && !cfg.allowLive) {
    return { ok: false, reason: 'live account blocked (HITL_ALLOW_LIVE=false until §7 acceptance passes)' };
  }
  if (!(r > 0)) return { ok: false, reason: `non-positive R (${r})` };
  if (!(lots > 0)) return { ok: false, reason: `non-positive lots (${lots})` };

  // SL on the correct side of entry.
  if (direction === 'BUY' && !(sl < entry)) return { ok: false, reason: 'BUY stop-loss must be below entry' };
  if (direction === 'SELL' && !(sl > entry)) return { ok: false, reason: 'SELL stop-loss must be above entry' };

  // Every TP beyond entry in the trade direction, strictly laddered.
  const ordered = direction === 'BUY'
    ? entry < tp1 && tp1 < tp2 && tp2 < tp3
    : entry > tp1 && tp1 > tp2 && tp2 > tp3;
  if (!ordered) return { ok: false, reason: 'TP ladder is not ordered beyond entry' };

  // Computed risk must respect the hard cap.
  const riskAmount = lots * r * valuePerPoint(spec);
  const riskPct = equity > 0 ? (riskAmount / equity) * 100 : Infinity;
  if (riskPct > cfg.maxRiskPerTrade + 1e-9) {
    return { ok: false, reason: `risk ${riskPct.toFixed(2)}% exceeds cap ${cfg.maxRiskPerTrade}%` };
  }

  return { ok: true };
}

export interface DispatchResult {
  status: 'OPEN' | 'FAILED';
  legs: HitlLeg[];
  message: string;
  alert?: string;       // operator-facing warning (e.g. partial fill held)
}

/**
 * Open every leg in order, fail-closed. Returns the updated legs (with tickets/
 * statuses) and the resulting session status.
 */
export async function openLegs(
  broker: HitlBroker,
  params: {
    symbol: string;
    direction: ComputedLevels['direction'];
    entryMode: HitlConfig['entryMode'];
    openPrice?: number;
    sl: number;
    legs: HitlLeg[];
    slippage: number;
    partialLegFailure: HitlConfig['partialLegFailure'];
  },
): Promise<DispatchResult> {
  const legs = params.legs.map((l) => ({ ...l }));
  let firstError: string | null = null;

  for (const leg of legs) {
    try {
      const { ticket } = await broker.openOrder({
        symbol: params.symbol,
        direction: params.direction,
        volume: leg.volume,
        entryMode: params.entryMode,
        openPrice: params.openPrice,
        stopLoss: params.sl,
        takeProfit: leg.tp,
        clientId: leg.clientId,        // correlation key; also shown as the platform comment
        slippage: params.slippage,
      });
      leg.ticket = ticket;
      leg.status = 'open';
    } catch (err) {
      leg.status = 'failed';
      firstError = err instanceof Error ? err.message : String(err);
      console.error(`[hitl/dispatch] leg ${leg.leg} (${leg.clientId}) failed:`, firstError);
      break; // stop dispatching further legs
    }
  }

  const opened = legs.filter((l) => l.status === 'open');
  const failed = legs.filter((l) => l.status === 'failed' || l.status === 'pending');

  // All good.
  if (failed.length === 0) {
    return { status: 'OPEN', legs, message: `opened ${opened.length} leg(s)` };
  }

  // Nothing opened → clean failure.
  if (opened.length === 0) {
    return { status: 'FAILED', legs, message: `dispatch failed before any fill: ${firstError}` };
  }

  // Partial fill → policy decides.
  if (params.partialLegFailure === 'auto_close') {
    for (const leg of opened) {
      try {
        if (leg.ticket) await broker.partialClose(leg.ticket, leg.volume);
        leg.status = 'closed';
      } catch (err) {
        console.error(`[hitl/dispatch] auto_close of leg ${leg.leg} failed:`, err);
      }
    }
    return { status: 'FAILED', legs, message: `partial fill auto-closed (${firstError})` };
  }

  // alert_hold (default): keep the filled leg(s), alert the operator.
  return {
    status: 'OPEN',
    legs,
    message: `partial fill held: ${opened.length} open, ${failed.length} failed`,
    alert: `⚠️ Partial dispatch: ${opened.length} leg(s) opened, leg failed (${firstError}). Held open per alert_hold — review manually.`,
  };
}
