// ─── TradingView Alert Types ────────────────────────
// Pipeline that listens for alerts from a TradingView indicator (Unicorn° Pro+
// or similar) and executes / manages trades on FusionMarkets via MetaApi.
//
// Six alert types map onto three actions:
//   activation         → open a trade
//   target_reached     → manage open trade (BE move, partial close, full close)
//   invalidation_hit   → close any open position for the instrument
//   potential_breaker, invalidation_warning → logged only

import type { SignalDirection } from './signals';

export type TvAlertType =
  | 'activation'
  | 'target_reached'
  | 'invalidation_hit'
  | 'invalidation_warning'
  | 'potential_breaker';

export type TvAlertStatus =
  | 'pending'
  | 'sent'
  | 'rejected'
  | 'error'
  | 'dry_run'
  | 'duplicate'
  | 'no_position'
  | 'logged';

export type TvPositionStatus =
  | 'open'
  | 'partial'
  | 'closed'
  | 'invalidated'
  | 'stopped_out';

export type SpilloverMode = 'cap' | 'split';

// ─── Webhook Payload ────────────────────────────────

export interface TvAlertPayload {
  secret: string;

  // Discriminator — set per-alert in TradingView's Message field
  alert_type: TvAlertType;

  // Symbol — usually matches Fusion; mapping is done server-side via tvAlertConfigs
  tv_symbol: string;
  direction?: 'LONG' | 'SHORT';     // required for activation; optional for management

  // Pricing
  tv_price: number;                  // current TradingView close
  fusion_price?: number;             // current FusionMarkets close (required when symbols differ)

  // Activation-only — breaker block H/L for stop placement
  breaker_high?: number;
  breaker_low?: number;
  // Fallback for SL when breaker_* aren't provided
  prev_5m_high?: number;
  prev_5m_low?: number;

  // Target Reached only — which R multiple fired
  r_level?: number;                  // 1, 2, 5 (or any value the indicator emits)

  // Optional overrides / metadata
  timestamp?: string;
  account_id?: string;
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

  // Risk / R targets
  riskPercent: number;
  tpRMultiple: number;
  beAtRMultiple: number;
  partialCloseAtRMultiple: number;
  partialClosePercent: number;
  closeAtRMultiple: number;
  slPipOffset: number;
  pipSize: number;
  pipValuePerLot: number;

  // Sizing
  sizingMode: 'percent_equity' | 'percent_balance' | 'strict';
  strictLots: number;
  minLotSize: number;
  lotStep: number;
  maxLotSize: number;
  maxLotsPerOrder: number;
  spilloverMode: SpilloverMode;
  minStopDistancePips: number;
  maxRiskPercent: number;
  maxSlippage: number;

  marginWarningThreshold: number;
  marginRejectThreshold: number;
  maxOffsetAbs: number;

  invalidationCloseEnabled: boolean;

  // Watermark
  watermarkEnabled: boolean;
  watermarkDrawdownThreshold: number;
  watermarkRiskReductionPercent: number;
  marketCloseTimezone: string;
  marketCloseHour: number;
  marketCloseMinute: number;
}

// ─── Computed Trade Parameters (activation only) ────

export interface TvTradeParams {
  direction: SignalDirection;
  fusionSymbol: string;

  fusionPriceAtAlert: number;
  breakerHighAdjusted: number | null;
  breakerLowAdjusted: number | null;
  offsetApplied: number;

  entryPrice: number;
  stopLoss: number;
  takeProfit: number;        // entry ± tpRMultiple × R
  rDistance: number;          // |entry - stopLoss|, in price units
  stopDistancePips: number;
  lotSize: number;
  riskAmount: number;
  riskMultiplierApplied: number;
  // For spillover mode='split': multiple identical orders
  orderSizes: number[];
  reason: string;
}

// ─── Validation ──────────────────────────────────────

export interface TvTradeValidation {
  ok: boolean;
  reason: string;
}

// ─── Position Management ────────────────────────────

export interface TvPositionRecord {
  id: string;
  configId: string;
  accountId: string;
  tvSymbol: string;
  fusionSymbol: string;
  direction: SignalDirection;
  entryPrice: number;
  originalStopLoss: number;
  currentStopLoss: number;
  rDistance: number;
  initialTakeProfit: number;
  initialLotSize: number;
  remainingLots: number;
  riskMultiplierApplied: number;
  metaapiPositionIds: string[];
  hit1R: boolean;
  hit2R: boolean;
  hit5R: boolean;
  movedToBreakeven: boolean;
  status: TvPositionStatus;
  isDryRun: boolean;
}
