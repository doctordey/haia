/**
 * HITL TP-ladder R-multiples (TP1 = breakeven trigger, TP2 = Leg A, TP3 = Leg B).
 *
 * Managed in-app (Settings → HITL → Targets, stored in hitl_settings) with the
 * env (HITL_TP{1,2,3}_R) as a fallback. DB overrides env. Resolved at signal
 * compute time; the absolute TP prices are then frozen onto the session, so
 * changing these later never moves an already-open trade.
 */

import { inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { hitlSettings } from '@/lib/db/schema';
import type { HitlConfig } from './config';
import type { TpMultiples } from './levels';

const KEYS = { tp1: 'tp1R', tp2: 'tp2R', tp3: 'tp3R' } as const;

function valid(n: number, fallback: number): number {
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function loadTpMultiples(cfg: HitlConfig): Promise<TpMultiples> {
  const rows = await db
    .select()
    .from(hitlSettings)
    .where(inArray(hitlSettings.key, [KEYS.tp1, KEYS.tp2, KEYS.tp3]));
  const m = Object.fromEntries(rows.map((r) => [r.key, Number(r.value)]));
  return {
    tp1: valid(m[KEYS.tp1], cfg.tp1R),
    tp2: valid(m[KEYS.tp2], cfg.tp2R),
    tp3: valid(m[KEYS.tp3], cfg.tp3R),
  };
}

/** Persist all three (validated: strictly increasing, positive). */
export async function setTpMultiples(m: TpMultiples): Promise<void> {
  for (const [k, key] of [[m.tp1, KEYS.tp1], [m.tp2, KEYS.tp2], [m.tp3, KEYS.tp3]] as [number, string][]) {
    const v = String(k);
    await db
      .insert(hitlSettings)
      .values({ key, value: v })
      .onConflictDoUpdate({ target: hitlSettings.key, set: { value: v } });
  }
}
