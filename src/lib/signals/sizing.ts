import type { SizingConfig, AccountInfo, ContractSpec, SizingResult } from '@/types/signals';

/**
 * Split a total lot size into chunks that respect the max-per-order limit.
 */
export function chunkLots(totalLots: number, maxPerOrder: number, lotStep: number): number[] {
  const chunks: number[] = [];
  let remaining = parseFloat(totalLots.toFixed(2));

  while (remaining > 0) {
    const chunk = Math.min(remaining, maxPerOrder);
    const rounded = Math.floor(chunk / lotStep) * lotStep;
    if (rounded < lotStep) break;
    chunks.push(parseFloat(rounded.toFixed(2)));
    remaining = parseFloat((remaining - rounded).toFixed(2));
  }

  return chunks;
}

export function calculateLotSize(
  config: SizingConfig,
  signal: { size: 'Small' | 'Medium' | 'Large'; entryPrice: number; stopLoss: number },
  account: AccountInfo,
  contractSpec: ContractSpec,
): SizingResult {
  let totalLots: number;
  let riskAmount = 0;
  let effectiveRisk = 0;
  let reason: string;

  const minResult = (r: string, extra?: Partial<SizingResult>): SizingResult => ({
    lotSize: contractSpec.minLotSize,
    riskAmount,
    effectiveRiskPercent: effectiveRisk,
    reason: r,
    isSplit: false,
    chunks: [contractSpec.minLotSize],
    ...extra,
  });

  // ── STRICT MODE ──
  if (config.mode === 'strict') {
    const lots = config.strictLots[signal.size] ?? config.strictLots['Medium'];
    totalLots = Math.min(lots, config.maxLotSize);
    reason = `Strict: ${signal.size} → ${totalLots} lots`;
  } else {
    // ── PERCENT MODES ──
    const baseAmount = config.mode === 'percent_balance' ? account.balance : account.equity;
    const multiplier = config.sizeMultipliers[signal.size] ?? 1.0;
    effectiveRisk = config.baseRiskPercent * multiplier;

    if (effectiveRisk > config.maxRiskPercent) {
      return minResult(
        `Risk ${effectiveRisk.toFixed(1)}% exceeds max ${config.maxRiskPercent}% — using min lot`,
      );
    }

    riskAmount = baseAmount * (effectiveRisk / 100);
    const stopDistance = Math.abs(signal.entryPrice - signal.stopLoss);

    if (stopDistance < config.minStopDistance) {
      return minResult(
        `Stop distance ${stopDistance.toFixed(1)} pts < min ${config.minStopDistance} pts — using min lot`,
      );
    }

    const rawLots = riskAmount / (stopDistance * contractSpec.pipValuePerLot);
    const steppedLots = Math.floor(rawLots / contractSpec.lotStep) * contractSpec.lotStep;
    totalLots = Math.max(contractSpec.minLotSize, Math.min(steppedLots, config.maxLotSize));
    reason =
      `${config.mode}: ${effectiveRisk.toFixed(1)}% of ` +
      `${config.mode === 'percent_balance' ? 'balance' : 'equity'} ` +
      `($${baseAmount.toFixed(0)}) = $${riskAmount.toFixed(2)} risk = ${totalLots.toFixed(2)} lots`;
  }

  // ── SPLIT TARGET ──
  if (config.executionMode === 'split_target') {
    const minLot = contractSpec.minLotSize;
    const step = contractSpec.lotStep;

    if (totalLots <= minLot) {
      const chunks = chunkLots(totalLots, config.maxLotsPerOrder, step);
      return {
        lotSize: totalLots,
        riskAmount,
        effectiveRiskPercent: effectiveRisk,
        reason,
        isSplit: false,
        splitFallbackReason: `Total lots (${totalLots}) = minimum — cannot split, using single position`,
        chunks,
      };
    }

    // TP1 gets the larger half (round up), TP2 gets the remainder
    const tp1Lots = parseFloat((Math.ceil((totalLots / 2) / step) * step).toFixed(2));
    const tp2Lots = parseFloat((totalLots - tp1Lots).toFixed(2));

    if (tp2Lots < minLot) {
      const chunks = chunkLots(totalLots, config.maxLotsPerOrder, step);
      return {
        lotSize: totalLots,
        riskAmount,
        effectiveRiskPercent: effectiveRisk,
        reason,
        isSplit: false,
        splitFallbackReason: `TP2 half (${tp2Lots}) < min lot (${minLot}) — cannot split, using single position`,
        chunks,
      };
    }

    const tp1Chunks = chunkLots(tp1Lots, config.maxLotsPerOrder, step);
    const tp2Chunks = chunkLots(tp2Lots, config.maxLotsPerOrder, step);

    return {
      lotSize: totalLots,
      riskAmount,
      effectiveRiskPercent: effectiveRisk,
      reason: `${reason} → split: TP1=${tp1Lots}, TP2=${tp2Lots}`,
      isSplit: true,
      tp1LotSize: tp1Lots,
      tp2LotSize: tp2Lots,
      chunks: [...tp1Chunks, ...tp2Chunks],
      tp1Chunks,
      tp2Chunks,
    };
  }

  // ── SINGLE (default) ──
  const chunks = chunkLots(parseFloat(totalLots.toFixed(2)), config.maxLotsPerOrder, contractSpec.lotStep);
  return {
    lotSize: parseFloat(totalLots.toFixed(2)),
    riskAmount,
    effectiveRiskPercent: effectiveRisk,
    reason,
    isSplit: false,
    chunks,
  };
}
