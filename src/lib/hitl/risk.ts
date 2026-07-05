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

import { eq, inArray } from 'drizzle-orm';
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

// ── per-account risk override ──
// One number per account, interpreted in the current global mode (percent → %,
// fixed → $). Absent → the account uses the global risk. Stored as risk.acct.<id>.
const ACCT_PREFIX = 'risk.acct.';

export async function loadAccountRiskValues(): Promise<Record<string, number>> {
  const rows = await db.select().from(hitlSettings);
  const map: Record<string, number> = {};
  for (const r of rows) {
    if (!r.key.startsWith(ACCT_PREFIX)) continue;
    const v = Number(r.value);
    if (Number.isFinite(v) && v > 0) map[r.key.slice(ACCT_PREFIX.length)] = v;
  }
  return map;
}

export async function setAccountRiskValue(accountId: string, value: number | null): Promise<void> {
  const key = `${ACCT_PREFIX}${accountId}`;
  if (value == null) {
    await db.delete(hitlSettings).where(eq(hitlSettings.key, key));
    return;
  }
  await db.insert(hitlSettings).values({ key, value: String(value) }).onConflictDoUpdate({ target: hitlSettings.key, set: { value: String(value) } });
}

/** Apply a per-account override (if any) onto the global settings. */
export function riskForAccount(global: RiskSettings, override: number | null | undefined): RiskSettings {
  if (override == null) return global;
  return global.mode === 'fixed' ? { ...global, fixedAmount: override } : { ...global, riskPct: override };
}
