/**
 * HITL operator-level configuration (env-driven).
 *
 * Mirrors the spec's `Config` dataclass: safety knobs, switches, and secrets
 * come from the environment and are validated once on worker boot. The *target
 * trading account* is NOT here — it is resolved from `tradingAccounts.hitlEnabled`
 * (see HITL_DESIGN.md §D9).
 *
 * `HITL_ENABLED` gates whether the bot + manager loop boot at all, so an
 * existing deployment that hasn't configured HITL keeps running untouched.
 */

export type SlFrom = 'range_size' | 'protective_edge';
export type PositionModel = 'two_position' | 'single';
export type EntryMode = 'market' | 'pending';
export type BeTrigger = 'both' | 'internal' | 'webhook';
export type ScannerFill = 'close_through' | 'touch';
export type PartialLegFailure = 'alert_hold' | 'auto_close';

export interface HitlConfig {
  enabled: boolean;
  allowLive: boolean;        // demo-only until §7 acceptance passes; flip on deliberately

  // ── secrets / identity ──
  telegramBotToken: string;
  authorizedUserIds: number[];
  operatorChatId: string;
  webhookSecret: string;

  // ── timing / intake guards ──
  signalTimeoutSeconds: number;
  signalCooldownSeconds: number;

  // ── risk ──
  riskPct: number;
  maxRiskPerTrade: number;

  // ── behaviour switches (locked defaults per HITL_DESIGN.md) ──
  slFrom: SlFrom;
  positionModel: PositionModel;
  entryMode: EntryMode;
  beTrigger: BeTrigger;
  tp2ClosePct: number;        // single-mode scale-out (inert in two_position)
  legSplit: number;           // two-position leg-A share of total lots
  maxDeviationPoints: number;
  scannerFill: ScannerFill;   // inert unless positionModel === 'single'
  partialLegFailure: PartialLegFailure;

  // ── symbol mapping (TradingView ticker → broker symbol; identity by default) ──
  symbolMap: Record<string, string>;
}

class HitlConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid HITL configuration:\n - ${problems.join('\n - ')}`);
    this.name = 'HitlConfigError';
  }
}

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  if (value === undefined || value.trim() === '') return fallback;
  return allowed.includes(value as T) ? (value as T) : (value as T); // validated in validateHitlConfig
}

/** Read raw env into a typed config (no throwing — `validateHitlConfig` enforces). */
export function loadHitlConfig(env: NodeJS.ProcessEnv = process.env): HitlConfig {
  return {
    enabled: env.HITL_ENABLED === 'true',
    allowLive: env.HITL_ALLOW_LIVE === 'true',

    telegramBotToken: env.HITL_TELEGRAM_BOT_TOKEN ?? '',
    authorizedUserIds: (env.AUTHORIZED_TELEGRAM_USER_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => Number(s)),
    operatorChatId: env.HITL_OPERATOR_CHAT_ID ?? '',
    webhookSecret: env.HITL_WEBHOOK_SECRET ?? '',

    signalTimeoutSeconds: num(env.SIGNAL_TIMEOUT_SECONDS, 300),
    signalCooldownSeconds: num(env.SIGNAL_COOLDOWN_SECONDS, 60),

    riskPct: num(env.RISK_PCT, 1.0),
    maxRiskPerTrade: num(env.MAX_RISK_PER_TRADE, 5.0),

    slFrom: oneOf(env.SL_FROM, ['range_size', 'protective_edge'] as const, 'range_size'),
    positionModel: oneOf(env.POSITION_MODEL, ['two_position', 'single'] as const, 'two_position'),
    entryMode: oneOf(env.ENTRY_MODE, ['market', 'pending'] as const, 'market'),
    beTrigger: oneOf(env.BE_TRIGGER, ['both', 'internal', 'webhook'] as const, 'both'),
    tp2ClosePct: num(env.TP2_CLOSE_PCT, 50),
    legSplit: num(env.LEG_SPLIT, 0.5),
    maxDeviationPoints: num(env.MAX_DEVIATION_POINTS, 10),
    scannerFill: oneOf(env.SCANNER_FILL, ['close_through', 'touch'] as const, 'close_through'),
    partialLegFailure: oneOf(env.PARTIAL_LEG_FAILURE, ['alert_hold', 'auto_close'] as const, 'alert_hold'),

    symbolMap: parseSymbolMap(env.HITL_SYMBOL_MAP),
  };
}

/** Parse `HITL_SYMBOL_MAP="UK10YBGBP:UKGILT, FOO:BAR"` into a lookup. */
function parseSymbolMap(raw: string | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  if (!raw) return map;
  for (const pair of raw.split(',')) {
    const [tv, broker] = pair.split(':').map((s) => s.trim());
    if (tv && broker) map[tv.toUpperCase()] = broker;
  }
  return map;
}

/** Resolve a TradingView ticker to the broker symbol (identity unless mapped). */
export function resolveBrokerSymbol(cfg: HitlConfig, tvSymbol: string): string {
  return cfg.symbolMap[tvSymbol.toUpperCase()] ?? tvSymbol;
}

/**
 * Throw `HitlConfigError` if the config is unusable. Only enforced when
 * `enabled` — a disabled HITL deployment needs no secrets.
 */
export function validateHitlConfig(cfg: HitlConfig): void {
  if (!cfg.enabled) return;

  const problems: string[] = [];

  // Secrets must come from env. The authorized-user list and operator chat id
  // are optional here — they can be (and usually are) managed in-app under
  // Settings → HITL → Access. Any ids set in env must still be numeric.
  if (!cfg.telegramBotToken) problems.push('HITL_TELEGRAM_BOT_TOKEN is required');
  if (!cfg.webhookSecret) problems.push('HITL_WEBHOOK_SECRET is required');
  if (cfg.authorizedUserIds.some((id) => !Number.isInteger(id))) problems.push('AUTHORIZED_TELEGRAM_USER_IDS must be all numeric');

  const enums: [string, string, readonly string[]][] = [
    ['SL_FROM', cfg.slFrom, ['range_size', 'protective_edge']],
    ['POSITION_MODEL', cfg.positionModel, ['two_position', 'single']],
    ['ENTRY_MODE', cfg.entryMode, ['market', 'pending']],
    ['BE_TRIGGER', cfg.beTrigger, ['both', 'internal', 'webhook']],
    ['SCANNER_FILL', cfg.scannerFill, ['close_through', 'touch']],
    ['PARTIAL_LEG_FAILURE', cfg.partialLegFailure, ['alert_hold', 'auto_close']],
  ];
  for (const [key, value, allowed] of enums) {
    if (!allowed.includes(value)) problems.push(`${key} must be one of ${allowed.join('|')} (got "${value}")`);
  }

  const positives: [string, number][] = [
    ['SIGNAL_TIMEOUT_SECONDS', cfg.signalTimeoutSeconds],
    ['SIGNAL_COOLDOWN_SECONDS', cfg.signalCooldownSeconds],
    ['RISK_PCT', cfg.riskPct],
    ['MAX_RISK_PER_TRADE', cfg.maxRiskPerTrade],
    ['MAX_DEVIATION_POINTS', cfg.maxDeviationPoints],
  ];
  for (const [key, value] of positives) {
    if (!Number.isFinite(value) || value <= 0) problems.push(`${key} must be a positive number (got "${value}")`);
  }

  if (cfg.riskPct > cfg.maxRiskPerTrade) {
    problems.push(`RISK_PCT (${cfg.riskPct}) must not exceed MAX_RISK_PER_TRADE (${cfg.maxRiskPerTrade})`);
  }
  if (!(cfg.legSplit > 0 && cfg.legSplit < 1)) {
    problems.push(`LEG_SPLIT must be strictly between 0 and 1 (got "${cfg.legSplit}")`);
  }
  if (!(cfg.tp2ClosePct > 0 && cfg.tp2ClosePct < 100)) {
    problems.push(`TP2_CLOSE_PCT must be strictly between 0 and 100 (got "${cfg.tp2ClosePct}")`);
  }

  if (problems.length > 0) throw new HitlConfigError(problems);
}

/** Convenience: load + validate in one call (used on worker boot). */
export function getValidatedHitlConfig(env: NodeJS.ProcessEnv = process.env): HitlConfig {
  const cfg = loadHitlConfig(env);
  validateHitlConfig(cfg);
  return cfg;
}

export { HitlConfigError };
