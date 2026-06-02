import { calculateLotSize } from './sizing';
import type {
  TvAlertConfig,
  TvAlertPayload,
  TvTradeParams,
  TvTradeValidation,
} from '@/types/tv-alerts';
import type { AccountInfo, ContractSpec, SizingConfig } from '@/types/signals';

/**
 * Translate a TradingView **Activation** alert into FusionMarkets trade
 * parameters (entry, SL, TP, lot size).
 *
 * Pricing:
 *   offset = tv_price - fusion_price   (0 when symbols match)
 *   highFusion = breakerHigh - offset  (falls back to prev_5m_high)
 *   lowFusion  = breakerLow  - offset
 *
 * Stop:
 *   LONG:  SL = lowFusion  - slPipOffset × pipSize
 *   SHORT: SL = highFusion + slPipOffset × pipSize
 *
 * Take Profit (initial, placed on the order):
 *   R   = |entry - SL|
 *   LONG:  TP = entry + tpRMultiple × R
 *   SHORT: TP = entry - tpRMultiple × R
 *
 * Lot sizing reuses the percent_equity engine, scaled by `riskMultiplier`
 * (which the caller derives from the watermark check).
 *
 * Spillover: if the unbounded lot calculation would exceed `maxLotSize`,
 * either cap at maxLotSize (mode='cap') or open N back-to-back orders that
 * collectively reach the target risk (mode='split').
 */
export function computeTradeParams(
  payload: TvAlertPayload,
  config: TvAlertConfig,
  account: AccountInfo,
  riskMultiplier: number,
): TvTradeParams | { error: string } {
  if (!payload.direction) return { error: 'Activation payload missing direction' };

  // ── Offset ───────────────────────────────────────
  const needsOffset = payload.tv_symbol !== config.fusionSymbol;
  const fusionPrice = needsOffset ? payload.fusion_price : payload.tv_price;
  if (fusionPrice == null || !Number.isFinite(fusionPrice)) {
    return { error: `Missing fusion_price for cross-feed symbol ${payload.tv_symbol} → ${config.fusionSymbol}` };
  }

  const offset = payload.tv_price - fusionPrice;
  if (Math.abs(offset) > config.maxOffsetAbs) {
    return {
      error:
        `Offset ${offset.toFixed(4)} for ${payload.tv_symbol}→${config.fusionSymbol} ` +
        `exceeds max ${config.maxOffsetAbs}.`,
    };
  }

  // ── Stop reference (breaker H/L, fall back to prev 5-min candle) ──
  const highTv = payload.breaker_high ?? payload.prev_5m_high;
  const lowTv  = payload.breaker_low  ?? payload.prev_5m_low;
  if (highTv == null || lowTv == null) {
    return { error: 'Activation payload must include breaker_high/low or prev_5m_high/low' };
  }
  if (highTv < lowTv) return { error: 'breaker_high < breaker_low — payload corrupted' };

  const highFusion = highTv - offset;
  const lowFusion  = lowTv  - offset;
  const pipBuffer  = config.slPipOffset * config.pipSize;
  const entryPrice = fusionPrice;

  // ── Stop loss ───────────────────────────────────
  let stopLoss: number;
  if (payload.direction === 'LONG') {
    stopLoss = lowFusion - pipBuffer;
    if (stopLoss >= entryPrice) {
      return { error: `LONG SL ${stopLoss} not below entry ${entryPrice} — breaker low above current price.` };
    }
  } else {
    stopLoss = highFusion + pipBuffer;
    if (stopLoss <= entryPrice) {
      return { error: `SHORT SL ${stopLoss} not above entry ${entryPrice} — breaker high below current price.` };
    }
  }

  const rDistance = Math.abs(entryPrice - stopLoss);
  const stopDistancePips = rDistance / config.pipSize;

  if (stopDistancePips < config.minStopDistancePips) {
    return {
      error:
        `Stop distance ${stopDistancePips.toFixed(1)} pips < min ${config.minStopDistancePips}.`,
    };
  }

  // ── Take profit at tpRMultiple × R ───────────────
  const takeProfit = payload.direction === 'LONG'
    ? entryPrice + config.tpRMultiple * rDistance
    : entryPrice - config.tpRMultiple * rDistance;

  // ── Lot sizing (scaled by riskMultiplier) ────────
  const effectiveRiskPercent = config.riskPercent * riskMultiplier;

  const sizingConfig: SizingConfig = {
    mode: config.sizingMode,
    executionMode: 'single',
    strictLots: { Small: config.strictLots, Medium: config.strictLots, Large: config.strictLots },
    baseRiskPercent: effectiveRiskPercent,
    sizeMultipliers: { Small: 1, Medium: 1, Large: 1 },
    maxRiskPercent: config.maxRiskPercent,
    minStopDistance: config.minStopDistancePips,
    // Run the engine with a huge cap first so we can detect spillover ourselves.
    // We re-cap below based on `spilloverMode`.
    maxLotSize: 1e9,
    maxLotsPerOrder: config.maxLotsPerOrder,
  };

  const contractSpec: ContractSpec = {
    pipValuePerLot: config.pipValuePerLot,
    minLotSize: config.minLotSize,
    lotStep: config.lotStep,
    maxOrderSize: config.maxLotsPerOrder,
  };

  // The sizing engine expects entry/sl in the same units as the math it
  // performs. We pass stopDistance in pips and matching pipValuePerLot.
  const sizing = calculateLotSize(
    sizingConfig,
    { size: 'Medium', entryPrice: stopDistancePips, stopLoss: 0 },
    account,
    contractSpec,
  );

  const unboundedLots = sizing.lotSize;
  const orderSizes = applySpillover(unboundedLots, config);
  if (orderSizes.length === 0) {
    return { error: 'Computed lot size is below the broker minimum.' };
  }
  const totalLots = orderSizes.reduce((s, v) => s + v, 0);

  const round = (n: number, dp = 5) => Math.round(n * 10 ** dp) / 10 ** dp;

  const spilloverNote = orderSizes.length > 1
    ? ` | split into ${orderSizes.length} orders (${orderSizes.join(' + ')})`
    : (unboundedLots > config.maxLotSize ? ` | capped at maxLotSize ${config.maxLotSize}` : '');

  return {
    direction: payload.direction,
    fusionSymbol: config.fusionSymbol,
    fusionPriceAtAlert: fusionPrice,
    breakerHighAdjusted: round(highFusion),
    breakerLowAdjusted: round(lowFusion),
    offsetApplied: round(offset),
    entryPrice: round(entryPrice),
    stopLoss: round(stopLoss),
    takeProfit: round(takeProfit),
    rDistance: round(rDistance),
    stopDistancePips: round(stopDistancePips, 2),
    lotSize: round(totalLots, 2),
    riskAmount: sizing.riskAmount,
    riskMultiplierApplied: riskMultiplier,
    orderSizes,
    reason:
      `${effectiveRiskPercent.toFixed(2)}% risk (multiplier ${riskMultiplier.toFixed(2)}) | ` +
      `SL ${stopDistancePips.toFixed(1)} pips | TP @ ${config.tpRMultiple}R${spilloverNote}`,
  };
}

/**
 * Apply spillover policy to an unbounded lot calculation.
 *  - 'cap':   one order at maxLotSize (or the calc if it fits)
 *  - 'split': N orders each at maxLotSize, with a remainder order ≥ minLotSize
 */
function applySpillover(unboundedLots: number, config: TvAlertConfig): number[] {
  const step = config.lotStep;
  const min = config.minLotSize;
  const max = config.maxLotSize;
  const round = (v: number) => Math.floor(v / step) * step;

  if (unboundedLots < min) return [];
  if (unboundedLots <= max) return [parseFloat(round(unboundedLots).toFixed(2))];

  if (config.spilloverMode === 'cap') {
    return [parseFloat(round(max).toFixed(2))];
  }

  // split mode
  const orders: number[] = [];
  let remaining = unboundedLots;
  while (remaining > max) {
    orders.push(parseFloat(round(max).toFixed(2)));
    remaining -= max;
  }
  if (remaining >= min) {
    orders.push(parseFloat(round(remaining).toFixed(2)));
  } else if (orders.length > 0 && remaining > 0) {
    // Roll the dust onto the last order if it doesn't bust the broker cap.
    const last = orders[orders.length - 1];
    if (last + remaining <= max) {
      orders[orders.length - 1] = parseFloat((last + round(remaining)).toFixed(2));
    }
  }
  return orders;
}

export function validatePayload(payload: Partial<TvAlertPayload>): TvTradeValidation {
  if (!payload.secret || typeof payload.secret !== 'string') {
    return { ok: false, reason: 'Missing secret' };
  }
  if (!payload.tv_symbol || typeof payload.tv_symbol !== 'string') {
    return { ok: false, reason: 'Missing tv_symbol' };
  }
  if (!payload.alert_type) {
    return { ok: false, reason: 'Missing alert_type' };
  }
  if (payload.alert_type === 'activation') {
    if (payload.direction !== 'LONG' && payload.direction !== 'SHORT') {
      return { ok: false, reason: `Invalid direction for activation: ${payload.direction}` };
    }
    if (!Number.isFinite(payload.tv_price)) {
      return { ok: false, reason: 'Missing or invalid tv_price' };
    }
    const hasBreaker = Number.isFinite(payload.breaker_high) && Number.isFinite(payload.breaker_low);
    const hasCandle  = Number.isFinite(payload.prev_5m_high) && Number.isFinite(payload.prev_5m_low);
    if (!hasBreaker && !hasCandle) {
      return { ok: false, reason: 'Activation requires breaker_high/low or prev_5m_high/low' };
    }
  }
  if (payload.alert_type === 'target_reached') {
    if (!Number.isFinite(payload.r_level)) {
      return { ok: false, reason: 'target_reached requires r_level' };
    }
  }
  return { ok: true, reason: 'OK' };
}
