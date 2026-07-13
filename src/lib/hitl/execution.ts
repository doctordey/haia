/**
 * HITL execution settings — position model + whether TP3 (the runner) is used.
 *
 * Operator-editable, DB-backed (hitl_settings), with env (POSITION_MODEL) as the
 * fallback. No migration. Combinations:
 *   • two_position + TP3  → Leg A → TP2, Leg B → TP3 (both BE at TP1).
 *   • single + TP3        → one position → TP3 (BE at TP1).
 *   • single + no TP3     → one position → TP2, full profit (BE at TP1).
 * Two-position needs TP3 (Leg B targets it), so that combo is rejected.
 */

import { inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { hitlSettings } from '@/lib/db/schema';
import type { HitlConfig, PositionModel } from './config';
import type { AlertStrategy as Strategy } from './alert';

export interface ExecutionSettings {
  positionModel: PositionModel;
  tp3Enabled: boolean;
}

// Per-strategy keys, with the pre-split shared keys as fallback so both
// strategies keep the existing values until the operator edits one.
const LEGACY = { model: 'exec.positionModel', tp3: 'exec.tp3Enabled' } as const;
const keysFor = (s: Strategy) => ({ model: `${s}.exec.positionModel`, tp3: `${s}.exec.tp3Enabled` });

export async function loadExecutionSettings(cfg: HitlConfig, strategy: Strategy): Promise<ExecutionSettings> {
  const k = keysFor(strategy);
  const rows = await db
    .select()
    .from(hitlSettings)
    .where(inArray(hitlSettings.key, [k.model, k.tp3, LEGACY.model, LEGACY.tp3]));
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const rawModel = m[k.model] ?? m[LEGACY.model];
  const positionModel: PositionModel = rawModel === 'single' ? 'single' : rawModel === 'two_position' ? 'two_position' : cfg.positionModel;
  // TP3 defaults on (preserves existing behaviour); only an explicit "false" disables it.
  const rawTp3 = m[k.tp3] ?? m[LEGACY.tp3];
  const tp3Enabled = rawTp3 === 'false' ? false : true;
  // Two-position is meaningless without a TP3 runner — coerce to single.
  if (positionModel === 'two_position' && !tp3Enabled) {
    return { positionModel: 'single', tp3Enabled: false };
  }
  return { positionModel, tp3Enabled };
}

export async function setExecutionSettings(s: ExecutionSettings, strategy: Strategy): Promise<void> {
  const k = keysFor(strategy);
  const entries: [string, string][] = [
    [k.model, s.positionModel],
    [k.tp3, String(s.tp3Enabled)],
  ];
  for (const [key, value] of entries) {
    await db.insert(hitlSettings).values({ key, value }).onConflictDoUpdate({ target: hitlSettings.key, set: { value } });
  }
}
