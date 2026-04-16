import type { CopySizingInput, CopySizingResult, CopyAccountInfo } from '@/types/copy-trading';
import { chunkLots } from '@/lib/signals/sizing';

export function calculateCopyLotSize(input: CopySizingInput, account: CopyAccountInfo): CopySizingResult {
  let lots: number;
  let detail: string;

  switch (input.sizingMode) {
    case 'fixed_multiplier': {
      lots = input.masterLots * input.multiplier;
      detail = `${input.masterLots} master × ${input.multiplier}x = ${lots.toFixed(2)} lots`;
      break;
    }

    case 'risk_percent': {
      if (!input.masterStopLoss) {
        lots = input.masterLots * input.multiplier;
        detail = `risk_percent — no master SL, fallback to multiplier: ${lots.toFixed(2)} lots`;
        break;
      }
      const base = input.riskBase === 'balance' ? account.balance : account.equity;
      const effectiveRisk = Math.min(input.riskPercent, input.maxRiskPercent);
      const riskAmount = base * (effectiveRisk / 100);
      const stopDist = Math.abs(input.masterEntryPrice - input.masterStopLoss);
      if (stopDist <= 0) {
        lots = input.minLotSize;
        detail = `risk_percent — stop distance is 0, using min lot`;
        break;
      }
      const rawLots = riskAmount / (stopDist * input.pipValuePerLot);
      lots = Math.floor(rawLots / input.lotStep) * input.lotStep;
      detail =
        `${effectiveRisk}% of ${input.riskBase} ($${base.toFixed(0)}) = $${riskAmount.toFixed(2)} ` +
        `/ (${stopDist.toFixed(1)}pts × $${input.pipValuePerLot}) = ${lots.toFixed(2)} lots`;
      break;
    }

    case 'fixed_lots': {
      lots = input.fixedLots;
      detail = `Fixed: ${lots} lots`;
      break;
    }

    default: {
      lots = input.minLotSize;
      detail = `Unknown sizing mode, using min lot`;
    }
  }

  lots = Math.max(input.minLotSize, Math.min(lots, input.maxLotSize));
  lots = parseFloat(lots.toFixed(2));

  const chunks = chunkLots(lots, input.maxLotsPerOrder, input.lotStep);

  return { lots, chunks, mode: input.sizingMode, detail };
}
