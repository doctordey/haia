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

import { eq, inArray, like, or } from 'drizzle-orm';
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
// One number per account, shared across strategies, stored WITH the mode it was
// entered under (risk.acct.<id> + risk.acct.<id>.mode). A strategy only applies
// the override when its own mode matches — a value typed as "2%" can never be
// silently reinterpreted as $2 by a strategy running in fixed mode. Overrides
// saved before modes were recorded have no mode and apply in any mode (legacy).
const ACCT_PREFIX = 'risk.acct.';
const MODE_SUFFIX = '.mode';

export interface AccountRiskOverride {
  value: number;
  mode?: RiskMode; // absent → legacy override, applies in any mode
}

export async function loadAccountRiskValues(): Promise<Record<string, AccountRiskOverride>> {
  const rows = await db
    .select()
    .from(hitlSettings)
    .where(like(hitlSettings.key, `${ACCT_PREFIX}%`));
  const values: Record<string, number> = {};
  const modes: Record<string, RiskMode> = {};
  for (const r of rows) {
    const rest = r.key.slice(ACCT_PREFIX.length);
    if (rest.endsWith(MODE_SUFFIX)) {
      modes[rest.slice(0, -MODE_SUFFIX.length)] = r.value === 'fixed' ? 'fixed' : 'percent';
    } else {
      const v = Number(r.value);
      if (Number.isFinite(v) && v > 0) values[rest] = v;
    }
  }
  const map: Record<string, AccountRiskOverride> = {};
  for (const [id, value] of Object.entries(values)) {
    map[id] = { value, mode: modes[id] };
  }
  return map;
}

export async function setAccountRiskValue(accountId: string, value: number | null, mode: RiskMode): Promise<void> {
  const key = `${ACCT_PREFIX}${accountId}`;
  const modeKey = `${key}${MODE_SUFFIX}`;
  if (value == null) {
    await db.delete(hitlSettings).where(or(eq(hitlSettings.key, key), eq(hitlSettings.key, modeKey)));
    return;
  }
  // Atomic: a value committed without its mode would be reinterpreted under a
  // stale mode — the exact bug the mode key exists to prevent.
  await db.transaction(async (tx) => {
    for (const [k, v] of [[key, String(value)], [modeKey, mode]] as [string, string][]) {
      await tx.insert(hitlSettings).values({ key: k, value: v }).onConflictDoUpdate({ target: hitlSettings.key, set: { value: v } });
    }
  });
}

/** Apply a per-account override onto the strategy's settings — only when the
 *  override's recorded mode matches (or is legacy/unrecorded). */
export function riskForAccount(global: RiskSettings, override: AccountRiskOverride | null | undefined): RiskSettings {
  if (override == null) return global;
  if (override.mode != null && override.mode !== global.mode) return global;
  return global.mode === 'fixed' ? { ...global, fixedAmount: override.value } : { ...global, riskPct: override.value };
}
