// ─── Copy Trading Types ──────────────────────────────

export type CopyPlatform = 'mt4' | 'mt5' | 'tradovate';

export type CopySizingMode = 'fixed_multiplier' | 'risk_percent' | 'fixed_lots';

export type CopyPositionStatus =
  | 'pending'
  | 'opening'
  | 'open'
  | 'closing'
  | 'closed'
  | 'error'
  | 'skipped'
  | 'dry_run';

export type CopyEventType =
  | 'master_open'
  | 'master_close'
  | 'master_modify_sl'
  | 'master_modify_tp'
  | 'slave_open_sent'
  | 'slave_open_filled'
  | 'slave_open_error'
  | 'slave_close_sent'
  | 'slave_close_filled'
  | 'slave_close_error'
  | 'slave_modify_sent'
  | 'slave_modify_filled'
  | 'slave_modify_error'
  | 'symbol_unmapped'
  | 'sizing_error'
  | 'margin_rejected'
  | 'skipped_filter';

// ─── Master Position Event (platform-agnostic) ──────

export interface MasterPositionEvent {
  type: 'open' | 'close' | 'modify';
  positionId: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  lots: number;
  entryPrice: number;
  closePrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  timestamp: Date;
  platform: CopyPlatform;
  previousSl?: number;
  previousTp?: number;
}

// ─── Sizing ──────────────────────────────────────────

export interface CopySizingInput {
  masterLots: number;
  masterEntryPrice: number;
  masterStopLoss: number | null;
  slaveSymbol: string;
  sizingMode: CopySizingMode;
  multiplier: number;
  riskPercent: number;
  riskBase: 'balance' | 'equity';
  maxRiskPercent: number;
  fixedLots: number;
  pipValuePerLot: number;
  minLotSize: number;
  lotStep: number;
  maxLotSize: number;
  maxLotsPerOrder: number;
}

export interface CopySizingResult {
  lots: number;
  chunks: number[];
  mode: CopySizingMode;
  detail: string;
}

export interface CopyAccountInfo {
  balance: number;
  equity: number;
  freeMargin: number;
}

// ─── Trade Interface (platform-agnostic) ─────────────

export interface CopyTradeInterface {
  platform: CopyPlatform;

  openPosition(params: {
    symbol: string;
    direction: 'BUY' | 'SELL';
    volume: number;
    stopLoss?: number;
    takeProfit?: number;
    comment?: string;
    slippage?: number;
  }): Promise<{ positionId: string }>;

  closePosition(positionId: string): Promise<void>;

  modifyPosition(positionId: string, params: {
    stopLoss?: number;
    takeProfit?: number;
  }): Promise<void>;

  getAccountInfo(): Promise<CopyAccountInfo>;
}

// ─── Master Monitor Interface ────────────────────────

export interface MasterMonitor {
  platform: CopyPlatform;
  accountId: string;
  onPositionOpen: ((event: MasterPositionEvent) => void) | null;
  onPositionClose: ((event: MasterPositionEvent) => void) | null;
  onPositionModify: ((event: MasterPositionEvent) => void) | null;
  start(): Promise<void>;
  stop(): Promise<void>;
}

// ─── Resolved Config (loaded from DB) ────────────────

export interface ResolvedCopyGroup {
  id: string;
  userId: string;
  name: string;
  masterAccountId: string;
  masterAccount: {
    id: string;
    platform: CopyPlatform;
    metaApiId: string | null;
    tradovateAccountId: string | null;
    tradovateEnvironment: string | null;
  };
  slaves: ResolvedCopySlave[];
}

export interface ResolvedCopySlave {
  id: string;
  accountId: string;
  account: {
    id: string;
    platform: CopyPlatform;
    metaApiId: string | null;
    tradovateAccountId: string | null;
    tradovateEnvironment: string | null;
    accessMode: string;
  };
  isEnabled: boolean;
  dryRun: boolean;
  sizingMode: CopySizingMode;
  multiplier: number;
  riskPercent: number;
  riskBase: 'balance' | 'equity';
  maxRiskPercent: number;
  fixedLots: number;
  maxLotSize: number;
  maxLotsPerOrder: number;
  maxSlippage: number;
  marginWarningPct: number;
  marginRejectPct: number;
  directionFilter: 'LONG' | 'SHORT' | null;
  maxOpenPositions: number | null;
  symbolMaps: Map<string, ResolvedSymbolMap>;
}

export interface ResolvedSymbolMap {
  id: string;
  masterSymbol: string;
  slaveSymbol: string;
  isEnabled: boolean;
  sizingMode: CopySizingMode | null;
  multiplier: number | null;
  riskPercent: number | null;
  fixedLots: number | null;
  pipValuePerLot: number;
  minLotSize: number;
  lotStep: number;
  copySl: boolean;
  copyTp: boolean;
  applyOffset: boolean;
  offsetInstrument: 'NQ' | 'ES' | null;
}

// ─── Tradovate Auth ──────────────────────────────────

export interface TradovateCredentials {
  username: string;
  password: string;
  appId?: string;
  appVersion?: string;
  cid?: number;
  sec?: string;
  environment: 'demo' | 'live';
}

export interface TradovateTokenResponse {
  accessToken: string;
  mdAccessToken: string;
  expirationTime: string;
  userId: number;
  userStatus: string;
  name: string;
}
