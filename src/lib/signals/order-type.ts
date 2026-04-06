import type { SignalDirection, OrderDecision } from '@/types/signals';

export function determineOrderType(
  direction: SignalDirection,
  adjustedEntryPrice: number,
  currentMarketPrice: number,
  threshold: number = 5.0,
): OrderDecision {
  const diff = currentMarketPrice - adjustedEntryPrice;
  const absDiff = Math.abs(diff);

  // Within threshold → market order
  if (absDiff <= threshold) {
    return {
      orderType: 'MARKET',
      reason:
        `Market ${currentMarketPrice.toFixed(2)} is ${absDiff.toFixed(1)}pts ` +
        `from entry ${adjustedEntryPrice.toFixed(2)} (within ${threshold}pt threshold) — MARKET`,
    };
  }

  if (direction === 'LONG') {
    if (currentMarketPrice < adjustedEntryPrice) {
      return {
        orderType: 'BUY_STOP',
        reason:
          `LONG: Market ${currentMarketPrice.toFixed(2)} is BELOW entry ` +
          `${adjustedEntryPrice.toFixed(2)} by ${absDiff.toFixed(1)}pts — BUY STOP`,
      };
    } else {
      return {
        orderType: 'BUY_LIMIT',
        reason:
          `LONG: Market ${currentMarketPrice.toFixed(2)} is ABOVE entry ` +
          `${adjustedEntryPrice.toFixed(2)} by ${absDiff.toFixed(1)}pts — BUY LIMIT`,
      };
    }
  } else {
    // SHORT
    if (currentMarketPrice < adjustedEntryPrice) {
      return {
        orderType: 'SELL_LIMIT',
        reason:
          `SHORT: Market ${currentMarketPrice.toFixed(2)} is BELOW entry ` +
          `${adjustedEntryPrice.toFixed(2)} by ${absDiff.toFixed(1)}pts — SELL LIMIT`,
      };
    } else {
      return {
        orderType: 'SELL_STOP',
        reason:
          `SHORT: Market ${currentMarketPrice.toFixed(2)} is ABOVE entry ` +
          `${adjustedEntryPrice.toFixed(2)} by ${absDiff.toFixed(1)}pts — SELL STOP`,
      };
    }
  }
}
