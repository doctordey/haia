import type {
  Instrument,
  PriceCache,
  SignalConfig,
  OffsetResult,
  ParsedSignal,
  AdjustedLevels,
} from '@/types/signals';

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

export function getOffset(
  instrument: Instrument,
  priceCache: PriceCache,
  config: SignalConfig,
): OffsetResult {
  if (config.offsetMode === 'none') {
    return {
      offset: 0,
      futuresPrice: 0,
      cfdPrice: 0,
      instrument,
      isStale: false,
      source: 'none',
      offsetAgeMs: null,
    };
  }

  // Try webhook offset first
  if (config.offsetMode === 'webhook') {
    const cached = priceCache.getOffset();
    if (cached) {
      const ageMs = Date.now() - cached.receivedAt;

      // Only use webhook data if it's fresh enough
      if (ageMs < STALE_THRESHOLD_MS) {
        const offset = instrument === 'NQ' ? cached.nqOffset : cached.esOffset;
        const futuresPrice = instrument === 'NQ' ? cached.nqFuturesPrice : cached.esFuturesPrice;
        const cfdPrice = instrument === 'NQ' ? cached.nas100Price : cached.us500Price;

        // Safety bounds check
        const maxOffset = instrument === 'NQ' ? config.nqMaxOffset : config.esMaxOffset;
        const minOffset = instrument === 'NQ' ? config.nqMinOffset : config.esMinOffset;

        if (Math.abs(offset) > maxOffset) {
          throw new Error(
            `[${instrument}] Webhook offset ${offset.toFixed(2)} exceeds max (${maxOffset}). ` +
            `Possible data error or contract roll.`,
          );
        }

        if (Math.abs(offset) < minOffset) {
          throw new Error(
            `[${instrument}] Webhook offset ${offset.toFixed(2)} below min (${minOffset}). ` +
            `Possible data error or contract roll.`,
          );
        }

        return {
          offset,
          futuresPrice,
          cfdPrice,
          instrument,
          isStale: false,
          source: 'webhook',
          offsetAgeMs: ageMs,
        };
      }
    }

    // Webhook data missing or stale — fall through to fixed
    console.warn(`[${instrument}] Webhook offset unavailable or stale, falling back to fixed offset`);
  }

  // Fixed fallback
  const fixedOffset = instrument === 'NQ' ? config.nqFixedOffset : config.esFixedOffset;
  return {
    offset: fixedOffset,
    futuresPrice: 0,
    cfdPrice: 0,
    instrument,
    isStale: true,
    source: 'fixed',
    offsetAgeMs: null,
  };
}

/**
 * Subtract offset from all signal levels.
 * Futures always trade higher than CFDs, so we subtract.
 */
export function adjustSignalLevels(
  signal: ParsedSignal,
  offset: number,
): AdjustedLevels {
  return {
    entry: Math.round((signal.entryPrice - offset) * 100) / 100,
    sl:    Math.round((signal.stopLoss - offset) * 100) / 100,
    tp1:   Math.round((signal.tp1 - offset) * 100) / 100,
    tp2:   Math.round((signal.tp2 - offset) * 100) / 100,
  };
}
