// ─── TradingView Alert Types ────────────────────────
// Pipeline that listens for alerts from a TradingView indicator (XBRUSD,
// UK10YBG) and executes corresponding trades on FusionMarkets via MetaApi.

import type { SignalDirection } from './signals';

export type TvAlertStatus =
  | 'pending'
  | 'sent'
  | 'rejected'
  | 'error'
  | 'dry_run'
  | 'duplicate';

// ─── Webhook Payload ────────────────────────────────
// JSON body posted by TradingView when an alert fires.

export interface TvAlertPayload {
  secret: string;
  tv_symbol: string;          // "XBRUSD" | "UK10YBG"
  direction: 'LONG' | 'SHORT';
  tv_price: number;           // current close on the TradingView chart symbol
  fusion_price?: number;      // current close on the FusionMarkets equivalent
                              // (required when tv_symbol != fusion_symbol)
  prev_5m_high: number;       // high of the last CLOSED 5-min candle on the TV symbol
  prev_5m_low: number;        // low  of the last CLOSED 5-min candle on the TV symbol
  timestamp?: string;
  account_id?: string;        // optional override — picks first enabled config otherwise
}

// ─── Config (maps to DB tvAlertConfigs row) ─────────

export interface TvAlertConfig {
  id: string;
  userId: string;
  accountId: string;
  tvSymbol: string;
  fusionSymbol: string;

  isEnabled: boolean;
  dryRun: boolean;

  riskPercent: number;
  rewardRiskRatio: number;
  slPipOffset: number;
  pipSize: number;
  pipValuePerLot: number;

  sizingMode: 'percent_equity' | 'percent_balance' | 'strict';
  strictLots: number;
  minLotSize: number;
  lotStep: number;
  maxLotSize: number;
  maxLotsPerOrder: number;
  minStopDistancePips: number;
  maxRiskPercent: number;
  maxSlippage: number;

  marginWarningThreshold: number;
  marginRejectThreshold: number;
  maxOffsetAbs: number;
}

// ─── Computed Trade Parameters ──────────────────────

export interface TvTradeParams {
  direction: SignalDirection;
  fusionSymbol: string;

  // Inputs (post-offset, in Fusion price space)
  fusionPriceAtAlert: number;
  prevCandleHighAdjusted: number;
  prevCandleLowAdjusted: number;
  offsetApplied: number;       // tv - fusion (0 when symbols match)

  // Outputs
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  stopDistancePips: number;
  lotSize: number;
  riskAmount: number;
  rewardRiskRatio: number;
  reason: string;
}

// ─── Validation Failure ─────────────────────────────

export interface TvTradeValidation {
  ok: boolean;
  reason: string;
}
