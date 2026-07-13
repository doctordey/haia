/**
 * TP-ladder R-multiples (TP1 = breakeven trigger, TP2 = Leg A, TP3 = Leg B),
 * per strategy (Unicorn / Forever).
 *
 * Managed in-app (Settings → Trading → Targets, stored in hitl_settings) with
 * fallbacks: strategy-scoped key → legacy shared key → env (HITL_TP{1,2,3}_R).
 * The legacy fallback means both strategies keep the pre-split values until the
 * operator edits one. Resolved at signal compute time; the absolute TP prices
 * are then frozen onto the session, so changing these never moves an open trade.
 */

import { inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { hitlSettings } from '@/lib/db/schema';
import type { HitlConfig } from './config';
import type { AlertStrategy as Strategy } from './alert';
import type { TpMultiples } from './levels';

const LEGACY = { tp1: 'tp1R', tp2: 'tp2R', tp3: 'tp3R' } as const;
const keysFor = (s: Strategy) => ({ tp1: `${s}.tp1R`, tp2: `${s}.tp2R`, tp3: `${s}.tp3R` });

function valid(n: number, fallback: number): number {
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function loadTpMultiples(cfg: HitlConfig, strategy: Strategy): Promise<TpMultiples> {
  const k = keysFor(strategy);
  const rows = await db
    .select()
    .from(hitlSettings)
    .where(inArray(hitlSettings.key, [k.tp1, k.tp2, k.tp3, LEGACY.tp1, LEGACY.tp2, LEGACY.tp3]));
  const m = Object.fromEntries(rows.map((r) => [r.key, Number(r.value)]));
  return {
    tp1: valid(m[k.tp1], valid(m[LEGACY.tp1], cfg.tp1R)),
    tp2: valid(m[k.tp2], valid(m[LEGACY.tp2], cfg.tp2R)),
    tp3: valid(m[k.tp3], valid(m[LEGACY.tp3], cfg.tp3R)),
  };
}

/** Persist all three for one strategy (validated: strictly increasing, positive). */
export async function setTpMultiples(m: TpMultiples, strategy: Strategy): Promise<void> {
  const k = keysFor(strategy);
  for (const [value, key] of [[m.tp1, k.tp1], [m.tp2, k.tp2], [m.tp3, k.tp3]] as [number, string][]) {
    const v = String(value);
    await db
      .insert(hitlSettings)
      .values({ key, value: v })
      .onConflictDoUpdate({ target: hitlSettings.key, set: { value: v } });
  }
}
