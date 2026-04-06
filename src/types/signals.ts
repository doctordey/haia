// ─── Signal Pipeline Types ───────────────────────────

export type Instrument = 'NQ' | 'ES';
export type SignalDirection = 'LONG' | 'SHORT';
export type SignalSize = 'Small' | 'Medium' | 'Large';
export type OrderType = 'MARKET' | 'BUY_STOP' | 'BUY_LIMIT' | 'SELL_STOP' | 'SELL_LIMIT';
export type SizingMode = 'strict' | 'percent_balance' | 'percent_equity';
export type ExecutionMode = 'single' | 'split_target';
export type OffsetMode = 'webhook' | 'fixed' | 'none';
export type ExecutionStatus = 'pending' | 'sent' | 'filled' | 'cancelled' | 'rejected' | 'error' | 'dry_run';

// ─── Parsed Data Structures ─────────────────────────

export interface ParsedSignal {
  tradeNumber: number;
  instrument: Instrument;
  direction: SignalDirection;
  entryPrice: number;
  tp1: number;
  tp2: number;
  stopLoss: number;
  size: SignalSize;
}

export interface ParsedCancellation {
  type: 'cancel_all' | 'cancel_specific';
  tradeNumber?: number;
  reason?: string;
}

export interface ParsedTPHit {
  instrument: Instrument;
  direction: SignalDirection;
  entryPrice: number;
  tpLevel: string;       // "TP1" or "TP2"
  tpPrice: number;
  profitPoints: number;
}

export type ParsedMessage =
  | { type: 'signals'; signals: ParsedSignal[]; warning?: string }
  | { type: 'cancellation'; cancellation: ParsedCancellation }
  | { type: 'tp_hit'; hits: ParsedTPHit[] }
  | { type: 'unknown'; raw: string };

// ─── Instrument Mapping ─────────────────────────────

export const INSTRUMENT_MAP: Record<Instrument, { fusionSymbol: string; futuresTicker: string }> = {
  NQ: { fusionSymbol: 'NAS100', futuresTicker: 'NQ=F' },
  ES: { fusionSymbol: 'US500', futuresTicker: 'ES=F' },
};

// ─── Order Type ─────────────────────────────────────

export interface OrderDecision {
  orderType: OrderType;
  reason: string;
}

// ─── Offset ─────────────────────────────────────────

export interface OffsetData {
  nqOffset: number;
  esOffset: number;
  nqFuturesPrice: number;
  esFuturesPrice: number;
  nas100Price: number;
  us500Price: number;
  receivedAt: number;        // timestamp ms
}

export interface PriceCache {
  getOffset(): OffsetData | null;
  getFusionPrice(symbol: string): number | null;
}

export interface OffsetResult {
  offset: number;
  futuresPrice: number;
  cfdPrice: number;
  instrument: Instrument;
  isStale: boolean;
  source: OffsetMode;
  offsetAgeMs: number | null;
}

export interface AdjustedLevels {
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
}

// ─── Contract Spec ──────────────────────────────────

export interface ContractSpec {
  pipValuePerLot: number;    // $ per POINT per lot
  minLotSize: number;
  lotStep: number;
  maxOrderSize: number;      // broker limit per single order
}

export const DEFAULT_CONTRACT_SPECS: Record<string, ContractSpec> = {
  NAS100: { pipValuePerLot: 1.00, minLotSize: 0.01, lotStep: 0.01, maxOrderSize: 100 },
  US500:  { pipValuePerLot: 1.00, minLotSize: 0.01, lotStep: 0.01, maxOrderSize: 100 },
};

// ─── Sizing ─────────────────────────────────────────

export interface SizingConfig {
  mode: SizingMode;
  executionMode: ExecutionMode;
  strictLots: Record<string, number>;
  baseRiskPercent: number;
  sizeMultipliers: Record<string, number>;
  maxRiskPercent: number;
  minStopDistance: number;
  maxLotSize: number;
  maxLotsPerOrder: number;
}

export interface AccountInfo {
  balance: number;
  equity: number;
}

export interface SizingResult {
  lotSize: number;
  riskAmount: number;
  effectiveRiskPercent: number;
  reason: string;
  isSplit: boolean;
  tp1LotSize?: number;
  tp2LotSize?: number;
  splitFallbackReason?: string;
  chunks: number[];
  tp1Chunks?: number[];
  tp2Chunks?: number[];
}

// ─── Margin ─────────────────────────────────────────

export interface MarginCheck {
  requiredMargin: number;
  freeMargin: number;
  sufficient: boolean;
  marginUtilization: number;   // percentage
}

// ─── Signal Config (maps to DB signalConfigs) ───────

export interface SignalConfig {
  id: string;
  isEnabled: boolean;
  dryRun: boolean;
  nqSymbol: string;
  esSymbol: string;
  // Lot sizes
  nqSmallLots: number;
  nqMediumLots: number;
  nqLargeLots: number;
  esSmallLots: number;
  esMediumLots: number;
  esLargeLots: number;
  // Offset
  offsetMode: OffsetMode;
  nqFixedOffset: number;
  esFixedOffset: number;
  nqMaxOffset: number;
  nqMinOffset: number;
  esMaxOffset: number;
  esMinOffset: number;
  // Sizing
  sizingMode: SizingMode;
  executionMode: ExecutionMode;
  baseRiskPercent: number;
  maxRiskPercent: number;
  minStopDistance: number;
  maxLotSize: number;
  // Multipliers
  smallMultiplier: number;
  mediumMultiplier: number;
  largeMultiplier: number;
  // Orders
  maxLotsPerOrder: number;
  marketOrderThreshold: number;
  maxSlippage: number;
  // Margin
  marginWarningThreshold: number;
  marginRejectThreshold: number;
}

// ─── Execution ──────────────────────────────────────

export interface ExecutionResult {
  signalId: string;
  configId: string;
  accountId: string;
  tradeNumber: number;
  splitIndex: number | null;        // null=single, 1=TP1, 2=TP2
  linkedExecutionId: string | null;
  chunkIndex: number | null;
  totalChunks: number | null;
  instrument: Instrument;
  fusionSymbol: string;
  direction: SignalDirection;
  signalEntry: number;
  signalSl: number;
  signalTp1: number;
  signalTp2: number;
  signalSize: SignalSize;
  lotSize: number;
  // Offset
  futuresPriceAtExec: number | null;
  fusionPriceAtExec: number | null;
  offsetApplied: number | null;
  offsetIsStale: boolean;
  // Adjusted
  adjustedEntry: number | null;
  adjustedSl: number | null;
  adjustedTp1: number | null;
  adjustedTp2: number | null;
  // Order
  orderType: OrderType | null;
  orderReason: string | null;
  // Result
  status: ExecutionStatus;
  metaapiOrderId: string | null;
  fillPrice: number | null;
  slippage: number | null;
  errorMessage: string | null;
  // Timing
  signalReceivedAt: Date | null;
  orderSentAt: Date | null;
  orderFilledAt: Date | null;
  totalLatencyMs: number | null;
  // Margin
  marginUtilization?: number;
  isDryRun: boolean;
}

// ─── MetaApi Interfaces (for dependency injection) ──

export interface MetaApiTradeInterface {
  createOrder(params: {
    symbol: string;
    type: string;
    volume: number;
    openPrice?: number;
    stopLoss: number;
    takeProfit: number;
    comment?: string;
    slippage?: number;
  }): Promise<{ orderId: string }>;

  cancelOrder(orderId: string): Promise<void>;

  modifyPosition(positionId: string, params: {
    stopLoss?: number;
    takeProfit?: number;
  }): Promise<void>;

  calculateMargin(params: {
    symbol: string;
    volume: number;
    type: string;
    openPrice: number;
  }): Promise<{ margin: number }>;

  getAccountInformation(): Promise<{
    balance: number;
    equity: number;
    freeMargin: number;
  }>;
}

export interface CancellationResult {
  executionId: string;
  status: 'cancelled' | 'already_filled' | 'error';
  message: string;
}
