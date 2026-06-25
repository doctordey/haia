/**
 * HITL symbol mapping — TradingView ticker → broker symbol.
 *
 * Managed from Settings (DB table `hitl_symbol_maps`), with the optional
 * `HITL_SYMBOL_MAP` env as a seed/fallback. DB rows take precedence. Resolution
 * happens once at webhook intake; everything downstream uses the broker symbol.
 */

import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { hitlSymbolMaps } from '@/lib/db/schema';
import type { HitlConfig } from './config';

export type SymbolMapRow = typeof hitlSymbolMaps.$inferSelect;

/** All DB overrides as an uppercase lookup. */
export async function loadDbSymbolMap(): Promise<Record<string, string>> {
  const rows = await db.select().from(hitlSymbolMaps);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.tvSymbol.toUpperCase()] = r.brokerSymbol;
  return map;
}

/** Pure: resolve against a merged map (identity when unmapped). */
export function resolveWithMap(map: Record<string, string>, tvSymbol: string): string {
  return map[tvSymbol.toUpperCase()] ?? tvSymbol;
}

/** Env seed + DB overrides (DB wins), then resolve. Used at webhook intake. */
export async function resolveBrokerSymbolLive(cfg: HitlConfig, tvSymbol: string): Promise<string> {
  const merged = { ...cfg.symbolMap, ...(await loadDbSymbolMap()) };
  return resolveWithMap(merged, tvSymbol);
}

// ── CRUD (Settings UI / API) ──

export async function listSymbolMaps(): Promise<SymbolMapRow[]> {
  return db.select().from(hitlSymbolMaps).orderBy(asc(hitlSymbolMaps.tvSymbol));
}

/** Create or update the broker symbol for a TradingView ticker (unique tvSymbol). */
export async function upsertSymbolMap(tvSymbol: string, brokerSymbol: string): Promise<SymbolMapRow> {
  const tv = tvSymbol.trim().toUpperCase();
  const broker = brokerSymbol.trim();
  const [row] = await db
    .insert(hitlSymbolMaps)
    .values({ tvSymbol: tv, brokerSymbol: broker })
    .onConflictDoUpdate({ target: hitlSymbolMaps.tvSymbol, set: { brokerSymbol: broker } })
    .returning();
  return row;
}

export async function deleteSymbolMap(id: string): Promise<void> {
  await db.delete(hitlSymbolMaps).where(eq(hitlSymbolMaps.id, id));
}
