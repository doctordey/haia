/**
 * HITL risk-per-trade settings — operator-editable, DB-backed (hitl_settings),
 * with env (RISK_PCT / MAX_RISK_PER_TRADE) as the fallback. No migration.
 *
 * Two modes:
 *  • percent — risk a % of equity per trade (scales with the account).
 *  • fixed   — risk a fixed $ amount per trade (mapped onto the percent path
 *              against live equity, so the same clamps + max cap still apply).
 *
 * The max-risk % is always a hard cap, enforced again at dispatch time.
 */

import { inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { hitlSettings } from '@/lib/db/schema';
import type { HitlConfig } from './config';

export type RiskMode = 'percent' | 'fixed';

export interface RiskSettings {
  mode: RiskMode;
  riskPct: number;      // used when mode === 'percent'
  fixedAmount: number;  // used when mode === 'fixed' ($ per trade)
  maxRiskPct: number;   // hard cap (% of equity), both modes
}

const KEYS = { mode: 'risk.mode', pct: 'risk.pct', fixed: 'risk.fixed', maxPct: 'risk.maxPct' } as const;

function pos(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function loadRiskSettings(cfg: HitlConfig): Promise<RiskSettings> {
  const rows = await db
    .select()
    .from(hitlSettings)
    .where(inArray(hitlSettings.key, [KEYS.mode, KEYS.pct, KEYS.fixed, KEYS.maxPct]));
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    mode: m[KEYS.mode] === 'fixed' ? 'fixed' : 'percent',
    riskPct: pos(m[KEYS.pct], cfg.riskPct),
    fixedAmount: pos(m[KEYS.fixed], 0),
    maxRiskPct: pos(m[KEYS.maxPct], cfg.maxRiskPerTrade),
  };
}

export async function setRiskSettings(s: RiskSettings): Promise<void> {
  const entries: [string, string][] = [
    [KEYS.mode, s.mode],
    [KEYS.pct, String(s.riskPct)],
    [KEYS.fixed, String(s.fixedAmount)],
    [KEYS.maxPct, String(s.maxRiskPct)],
  ];
  for (const [key, value] of entries) {
    await db.insert(hitlSettings).values({ key, value }).onConflictDoUpdate({ target: hitlSettings.key, set: { value } });
  }
}
