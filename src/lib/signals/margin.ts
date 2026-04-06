import type { SignalDirection, MarginCheck, MetaApiTradeInterface } from '@/types/signals';

export async function checkMargin(
  account: MetaApiTradeInterface,
  symbol: string,
  totalLots: number,
  direction: SignalDirection,
): Promise<MarginCheck> {
  const accountInfo = await account.getAccountInformation();
  const freeMargin = accountInfo.freeMargin;

  const marginReq = await account.calculateMargin({
    symbol,
    volume: totalLots,
    type: direction === 'LONG' ? 'ORDER_TYPE_BUY' : 'ORDER_TYPE_SELL',
  });

  return {
    requiredMargin: marginReq.margin,
    freeMargin,
    sufficient: freeMargin >= marginReq.margin,
    marginUtilization: freeMargin > 0 ? (marginReq.margin / freeMargin) * 100 : 100,
  };
}

export function evaluateMargin(
  marginCheck: MarginCheck,
  warningThreshold: number,
  rejectThreshold: number,
): { action: 'proceed' | 'warn' | 'reject'; message: string } {
  if (!marginCheck.sufficient || marginCheck.marginUtilization > rejectThreshold) {
    return {
      action: 'reject',
      message:
        `Margin rejected: utilization ${marginCheck.marginUtilization.toFixed(1)}% ` +
        `exceeds ${rejectThreshold}% threshold. Required: $${marginCheck.requiredMargin.toFixed(2)}, ` +
        `Free: $${marginCheck.freeMargin.toFixed(2)}`,
    };
  }

  if (marginCheck.marginUtilization > warningThreshold) {
    return {
      action: 'warn',
      message:
        `Margin warning: utilization ${marginCheck.marginUtilization.toFixed(1)}% ` +
        `exceeds ${warningThreshold}% warning threshold. Required: $${marginCheck.requiredMargin.toFixed(2)}, ` +
        `Free: $${marginCheck.freeMargin.toFixed(2)}`,
    };
  }

  return {
    action: 'proceed',
    message: `Margin OK: utilization ${marginCheck.marginUtilization.toFixed(1)}%`,
  };
}
