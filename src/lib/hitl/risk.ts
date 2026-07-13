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
import type { AlertStrategy as Strategy } from './alert';

export type RiskMode = 'percent' | 'fixed';

export interface RiskSettings {
  mode: RiskMode;
  riskPct: number;      // used when mode === 'percent'
  fixedAmount: number;  // used when mode === 'fixed' ($ per trade)
  maxRiskPct: number;   // hard cap (% of equity), both modes
}

// Per-strategy keys, with the pre-split shared keys as fallback so both
// strategies keep the existing values until the operator edits one.
const LEGACY = { mode: 'risk.mode', pct: 'risk.pct', fixed: 'risk.fixed', maxPct: 'risk.maxPct' } as const;
const keysFor = (s: Strategy) => ({
  mode: `${s}.risk.mode`,
  pct: `${s}.risk.pct`,
  fixed: `${s}.risk.fixed`,
  maxPct: `${s}.risk.maxPct`,
});

function pos(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function loadRiskSettings(cfg: HitlConfig, strategy: Strategy): Promise<RiskSettings> {
  const k = keysFor(strategy);
  const rows = await db
    .select()
    .from(hitlSettings)
    .where(inArray(hitlSettings.key, [k.mode, k.pct, k.fixed, k.maxPct, LEGACY.mode, LEGACY.pct, LEGACY.fixed, LEGACY.maxPct]));
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const mode = m[k.mode] ?? m[LEGACY.mode];
  return {
    mode: mode === 'fixed' ? 'fixed' : 'percent',
    riskPct: pos(m[k.pct], pos(m[LEGACY.pct], cfg.riskPct)),
    fixedAmount: pos(m[k.fixed], pos(m[LEGACY.fixed], 0)),
    maxRiskPct: pos(m[k.maxPct], pos(m[LEGACY.maxPct], cfg.maxRiskPerTrade)),
  };
}

export async function setRiskSettings(s: RiskSettings, strategy: Strategy): Promise<void> {
  const k = keysFor(strategy);
  const entries: [string, string][] = [
    [k.mode, s.mode],
    [k.pct, String(s.riskPct)],
    [k.fixed, String(s.fixedAmount)],
    [k.maxPct, String(s.maxRiskPct)],
  ];
  for (const [key, value] of entries) {
    await db.insert(hitlSettings).values({ key, value }).onConflictDoUpdate({ target: hitlSettings.key, set: { value } });
  }
}

// ── per-account risk override ──
// One number per account, shared across strategies and interpreted in each
// strategy's mode (percent → %, fixed → $). Absent → the account uses that
// strategy's risk. Stored as risk.acct.<id>.
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
