// Resolve the SL anchor for an activation alert. The dispatch is keyed off
// config.slAnchorMode and may hit MetaApi (swing mode) or the breaker
// publisher cache, or fall back to payload-supplied values.

import type { TvAlertConfig, TvAlertPayload, SlAnchorMode } from '@/types/tv-alerts';
import type { SlAnchor } from '@/lib/signals/tv-alert';
import { getBreakerContext } from '@/lib/signals/breaker-context';
import { fetchRecentCandles } from '@/lib/metaapi-candles';
import { findAnchorForDirection } from '@/lib/signals/swing-detection';

export interface ResolveAnchorParams {
  payload: TvAlertPayload;
  config: TvAlertConfig;
  metaApiId: string;
  fusionPrice: number;       // entry price in Fusion space — needed by swing-mode wrong-side filter
  offset: number;             // tv - fusion, subtracted from any TV-space values
}

/**
 * Resolve the SL anchor. Returns the prepared SlAnchor or an error string.
 *
 * The fallback chain is: try the configured mode → if it can't produce an
 * anchor (no data, no swing found), fall back to prior_candle if the payload
 * carries prev_5m_high/low → otherwise fixed_pips using config.fixedSlPips.
 */
export async function resolveSlAnchor(
  params: ResolveAnchorParams,
): Promise<SlAnchor | { error: string }> {
  const { payload, config, metaApiId, fusionPrice, offset } = params;
  const direction = payload.direction!;

  // Mode 1: breaker publisher cache
  if (config.slAnchorMode === 'breaker_publisher') {
    const ctx = await getBreakerContext(payload.tv_symbol, config.accountId);
    if (ctx) {
      const fusionPriceAnchor = direction === 'LONG' ? ctx.breakerLow : ctx.breakerHigh;
      return {
        source: 'breaker_publisher',
        slPriceFusion: fusionPriceAnchor - offset,
        note: `breaker ${Math.round(ctx.ageMs / 1000)}s old`,
      };
    }
    return fallbackChain('breaker publisher empty', payload, config, fusionPrice, offset);
  }

  // Mode 2: server-side swing detection from MetaApi candles
  if (config.slAnchorMode === 'swing') {
    try {
      const candles = await fetchRecentCandles(
        metaApiId,
        config.fusionSymbol,
        config.swingTimeframe,
        config.swingLookback,
      );
      if (candles.length < 2 * config.swingStrength + 1) {
        return fallbackChain(
          `swing: only ${candles.length} candles fetched`,
          payload, config, fusionPrice, offset,
        );
      }
      const swing = findAnchorForDirection(candles, direction, fusionPrice, config.swingStrength);
      if (!swing.found) {
        return fallbackChain(
          `swing: no qualifying ${direction === 'LONG' ? 'low' : 'high'} below/above entry in ${config.swingLookback} bars`,
          payload, config, fusionPrice, offset,
        );
      }
      return {
        source: 'swing',
        slPriceFusion: swing.price,    // already in Fusion price space (came from Fusion symbol candles)
        note: `${direction === 'LONG' ? 'swingLow' : 'swingHigh'} @ ${swing.price.toFixed(5)} ${config.swingTimeframe}/${config.swingStrength}`,
      };
    } catch (err) {
      return fallbackChain(
        `swing fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        payload, config, fusionPrice, offset,
      );
    }
  }

  // Mode 3: payload-supplied prior candle
  if (config.slAnchorMode === 'prior_candle') {
    return priorCandleAnchor(payload, direction, offset, 'prior_candle');
  }

  // Mode 4: fixed pip distance from entry
  if (config.slAnchorMode === 'fixed_pips') {
    return fixedPipsAnchor(direction, fusionPrice, config);
  }

  return { error: `Unknown slAnchorMode: ${config.slAnchorMode}` };
}

// ─── Helpers ─────────────────────────────────────

function fallbackChain(
  reason: string,
  payload: TvAlertPayload,
  config: TvAlertConfig,
  fusionPrice: number,
  offset: number,
): SlAnchor {
  const direction = payload.direction!;
  // Try prior_candle from payload if available
  const candle = priorCandleAnchor(payload, direction, offset, `${reason} → prior_candle`);
  if (!('error' in candle)) return candle;
  // Last resort: fixed pips
  return fixedPipsAnchor(direction, fusionPrice, config, `${reason} → fixed_pips`);
}

function priorCandleAnchor(
  payload: TvAlertPayload,
  direction: 'LONG' | 'SHORT',
  offset: number,
  note: string,
): SlAnchor | { error: string } {
  const high = payload.prev_5m_high;
  const low = payload.prev_5m_low;
  if (high == null || low == null || !Number.isFinite(high) || !Number.isFinite(low)) {
    return { error: 'prior_candle: payload missing prev_5m_high/low' };
  }
  const ref = direction === 'LONG' ? low : high;
  return {
    source: 'prior_candle',
    slPriceFusion: ref - offset,
    note,
  };
}

function fixedPipsAnchor(
  direction: 'LONG' | 'SHORT',
  fusionPrice: number,
  config: TvAlertConfig,
  note: string = `fixed ${config.fixedSlPips} pips`,
): SlAnchor {
  const dist = config.fixedSlPips * config.pipSize;
  const sl = direction === 'LONG' ? fusionPrice - dist : fusionPrice + dist;
  return {
    source: 'fixed_pips',
    fixedSlPriceFusion: sl,
    note,
  };
}

export const ALL_ANCHOR_MODES: SlAnchorMode[] = ['breaker_publisher', 'swing', 'prior_candle', 'fixed_pips'];
