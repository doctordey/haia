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

export interface ExecutionSettings {
  positionModel: PositionModel;
  tp3Enabled: boolean;
}

const KEYS = { model: 'exec.positionModel', tp3: 'exec.tp3Enabled' } as const;

export async function loadExecutionSettings(cfg: HitlConfig): Promise<ExecutionSettings> {
  const rows = await db
    .select()
    .from(hitlSettings)
    .where(inArray(hitlSettings.key, [KEYS.model, KEYS.tp3]));
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const positionModel: PositionModel = m[KEYS.model] === 'single' ? 'single' : m[KEYS.model] === 'two_position' ? 'two_position' : cfg.positionModel;
  // TP3 defaults on (preserves existing behaviour); only an explicit "false" disables it.
  const tp3Enabled = m[KEYS.tp3] === 'false' ? false : true;
  // Two-position is meaningless without a TP3 runner — coerce to single.
  if (positionModel === 'two_position' && !tp3Enabled) {
    return { positionModel: 'single', tp3Enabled: false };
  }
  return { positionModel, tp3Enabled };
}

export async function setExecutionSettings(s: ExecutionSettings): Promise<void> {
  const entries: [string, string][] = [
    [KEYS.model, s.positionModel],
    [KEYS.tp3, String(s.tp3Enabled)],
  ];
  for (const [key, value] of entries) {
    await db.insert(hitlSettings).values({ key, value }).onConflictDoUpdate({ target: hitlSettings.key, set: { value } });
  }
}
