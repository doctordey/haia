import { calculateLotSize } from './sizing';
import type {
  TvAlertConfig,
  TvAlertPayload,
  TvTradeParams,
  TvTradeValidation,
} from '@/types/tv-alerts';
import type { AccountInfo, ContractSpec, SizingConfig } from '@/types/signals';

/**
 * Translate a TradingView alert into FusionMarkets trade parameters.
 *
 * Pricing flow:
 *   offset = tvPrice - fusionPrice         (0 for symbols that are native fusion feeds)
 *   prevHighFusion = prevTvHigh - offset
 *   prevLowFusion  = prevTvLow  - offset
 *
 * Stop placement (in Fusion price space):
 *   LONG:  SL = prevLowFusion  - slPipOffset × pipSize
 *          TP = entry + RR × (entry - SL)
 *   SHORT: SL = prevHighFusion + slPipOffset × pipSize
 *          TP = entry - RR × (SL - entry)
 *
 * Entry is the live Fusion market price at alert receipt; the order is sent
 * as a MARKET order.
 */
export function computeTradeParams(
  payload: TvAlertPayload,
  config: TvAlertConfig,
  account: AccountInfo,
): TvTradeParams | { error: string } {
  // Offset — webhook supplies fusion_price when symbols diverge (e.g. UK10YBG → UKGILT)
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
        `exceeds max ${config.maxOffsetAbs}. Possible data error.`,
    };
  }

  const prevHighFusion = payload.prev_5m_high - offset;
  const prevLowFusion = payload.prev_5m_low - offset;

  const pipBuffer = config.slPipOffset * config.pipSize;
  const entryPrice = fusionPrice;

  let stopLoss: number;
  let takeProfit: number;
  if (payload.direction === 'LONG') {
    stopLoss = prevLowFusion - pipBuffer;
    if (stopLoss >= entryPrice) {
      return { error: `LONG SL ${stopLoss} not below entry ${entryPrice} — candle low above current price.` };
    }
    takeProfit = entryPrice + config.rewardRiskRatio * (entryPrice - stopLoss);
  } else {
    stopLoss = prevHighFusion + pipBuffer;
    if (stopLoss <= entryPrice) {
      return { error: `SHORT SL ${stopLoss} not above entry ${entryPrice} — candle high below current price.` };
    }
    takeProfit = entryPrice - config.rewardRiskRatio * (stopLoss - entryPrice);
  }

  const stopDistancePrice = Math.abs(entryPrice - stopLoss);
  const stopDistancePips = stopDistancePrice / config.pipSize;

  if (stopDistancePips < config.minStopDistancePips) {
    return {
      error:
        `Stop distance ${stopDistancePips.toFixed(1)} pips < min ${config.minStopDistancePips} — ` +
        `would risk unreasonable lot size.`,
    };
  }

  // Reuse existing sizing engine. Map our single-tier config to the multi-tier
  // shape the engine expects by pinning size=Medium with multiplier=1.0.
  const sizingConfig: SizingConfig = {
    mode: config.sizingMode,
    executionMode: 'single',
    strictLots: { Small: config.strictLots, Medium: config.strictLots, Large: config.strictLots },
    baseRiskPercent: config.riskPercent,
    sizeMultipliers: { Small: 1, Medium: 1, Large: 1 },
    maxRiskPercent: config.maxRiskPercent,
    // Engine's stopDistance is in the same units as the entry/sl we pass — pips here.
    minStopDistance: config.minStopDistancePips,
    maxLotSize: config.maxLotSize,
    maxLotsPerOrder: config.maxLotsPerOrder,
  };

  // The existing sizing engine treats `pipValuePerLot` as $-per-point. We want
  // $-per-PIP — so we scale stop distance into pips before handing it over.
  const contractSpec: ContractSpec = {
    pipValuePerLot: config.pipValuePerLot,
    minLotSize: config.minLotSize,
    lotStep: config.lotStep,
    maxOrderSize: config.maxLotsPerOrder,
  };

  const sizing = calculateLotSize(
    sizingConfig,
    { size: 'Medium', entryPrice: stopDistancePips, stopLoss: 0 },
    account,
    contractSpec,
  );

  const round = (n: number, dp = 5) => Math.round(n * 10 ** dp) / 10 ** dp;

  return {
    direction: payload.direction,
    fusionSymbol: config.fusionSymbol,
    fusionPriceAtAlert: fusionPrice,
    prevCandleHighAdjusted: round(prevHighFusion),
    prevCandleLowAdjusted: round(prevLowFusion),
    offsetApplied: round(offset),
    entryPrice: round(entryPrice),
    stopLoss: round(stopLoss),
    takeProfit: round(takeProfit),
    stopDistancePips: round(stopDistancePips, 2),
    lotSize: sizing.lotSize,
    riskAmount: sizing.riskAmount,
    rewardRiskRatio: config.rewardRiskRatio,
    reason: `${sizing.reason} | RR=${config.rewardRiskRatio}:1 | SL=${stopDistancePips.toFixed(1)} pips`,
  };
}

export function validatePayload(payload: Partial<TvAlertPayload>): TvTradeValidation {
  if (!payload.secret || typeof payload.secret !== 'string') {
    return { ok: false, reason: 'Missing secret' };
  }
  if (!payload.tv_symbol || typeof payload.tv_symbol !== 'string') {
    return { ok: false, reason: 'Missing tv_symbol' };
  }
  if (payload.direction !== 'LONG' && payload.direction !== 'SHORT') {
    return { ok: false, reason: `Invalid direction: ${payload.direction}` };
  }
  if (!Number.isFinite(payload.tv_price)) {
    return { ok: false, reason: 'Missing or invalid tv_price' };
  }
  if (!Number.isFinite(payload.prev_5m_high) || !Number.isFinite(payload.prev_5m_low)) {
    return { ok: false, reason: 'Missing or invalid prev_5m_high / prev_5m_low' };
  }
  if ((payload.prev_5m_high as number) < (payload.prev_5m_low as number)) {
    return { ok: false, reason: 'prev_5m_high < prev_5m_low — payload corrupted' };
  }
  return { ok: true, reason: 'OK' };
}
