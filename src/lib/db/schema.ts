import { pgTable, text, boolean, integer, real, timestamp, date, unique, index, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';

// ─── Users ───────────────────────────────────────────

export const users = pgTable('users', {
  id:            text('id').primaryKey().$defaultFn(() => createId()),
  email:         text('email').notNull().unique(),
  password:      text('password'),
  name:          text('name'),
  username:      text('username').unique(),
  avatarUrl:     text('avatar_url'),
  timezone:      text('timezone').notNull().default('UTC'),
  calendarStart: text('calendar_start').notNull().default('monday'),
  currency:      text('currency').notNull().default('USD'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
});

export const usersRelations = relations(users, ({ many }) => ({
  accounts:      many(tradingAccounts),
  sessions:      many(sessions),
  flexCards:     many(flexCards),
  roles:         many(userRoles),
  signalSources: many(signalSources),
  signalConfigs: many(signalConfigs),
  journalEntries: many(tradeJournal),
  apiKeys:       many(apiKeys),
}));

// ─── Sessions ────────────────────────────────────────

export const sessions = pgTable('sessions', {
  id:        text('id').primaryKey().$defaultFn(() => createId()),
  userId:    text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token:     text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
});

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

// ─── Trading Accounts ────────────────────────────────

export const tradingAccounts = pgTable('trading_accounts', {
  id:         text('id').primaryKey().$defaultFn(() => createId()),
  userId:     text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:       text('name').notNull(),
  platform:   text('platform').notNull(),
  metaApiId:  text('meta_api_id').notNull().unique(),
  server:     text('server').notNull(),
  login:      text('login').notNull(),
  broker:     text('broker'),
  leverage:   integer('leverage'),
  currency:   text('currency').notNull().default('USD'),
  accountType: text('account_type'),                              // detected/declared: "live" | "demo" | null (unknown)
  accessMode: text('access_mode').notNull().default('investor'),  // "investor" (read-only) | "trading" (full access)
  hitlEnabled: boolean('hitl_enabled').notNull().default(false),   // opt-in: this account receives approved HITL trades

  // ── Public-endpoint label overrides ──
  // What the REST distribute endpoints expose for the identifying fields. When a
  // label is null the real value (name / login / accountType) is exposed instead.
  // Lets an operator publish an account under a pseudonym without changing the
  // underlying broker credentials.
  labelName:    text('label_name'),
  labelLogin:   text('label_login'),
  labelType:    text('label_type'),                               // override: "live" | "demo" | null
  labelServer:  text('label_server'),                             // override broker server string
  labelBroker:  text('label_broker'),                             // override broker name
  labelLeverage: integer('label_leverage'),                       // override leverage
  beginningDate: date('beginning_date'),                          // inception / tracking-start date exposed via the API

  // Broker/server timezone as a fixed UTC offset (e.g. "+03:00"). MT4/MT5
  // servers commonly run on UTC+3. Manual trade times are entered in this
  // timezone and tagged with the offset so they're stored as the correct
  // instant regardless of where the app runs.
  serverTimezone: text('server_timezone').notNull().default('+03:00'),

  // When true, manual entries are kept distinguishable from live (broker-synced)
  // ones — surfaced as a `source` field and filterable. When false the two are
  // pooled and reported together everywhere.
  distinguishManual: boolean('distinguish_manual').notNull().default(true),

  // Anchor for the derived balance/equity curve:
  //   balance = openingBalance + Σ non-excluded deposits/withdrawals + Σ non-excluded trade PnL
  // Set by the import ?openingBalance= param; 0 for broker accounts whose
  // deposits arrive as balance operations.
  openingBalance: real('opening_balance').notNull().default(0),

  isActive:   boolean('is_active').notNull().default(true),
  lastSyncAt: timestamp('last_sync_at'),
  syncStatus: text('sync_status').notNull().default('pending'),
  syncError:  text('sync_error'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index('trading_accounts_user_id_idx').on(table.userId),
]);

export const tradingAccountsRelations = relations(tradingAccounts, ({ one, many }) => ({
  user:           one(users, { fields: [tradingAccounts.userId], references: [users.id] }),
  trades:         many(trades),
  dailySnapshots: many(dailySnapshots),
  accountStats:   one(accountStats),
  hitlSessions:   many(hitlSessions),
}));

// ─── Trades ──────────────────────────────────────────

export const trades = pgTable('trades', {
  id:          text('id').primaryKey().$defaultFn(() => createId()),
  accountId:   text('account_id').notNull().references(() => tradingAccounts.id, { onDelete: 'cascade' }),
  ticket:      text('ticket').notNull(),
  symbol:      text('symbol').notNull(),
  direction:   text('direction').notNull(),
  lots:        real('lots').notNull(),
  entryPrice:  real('entry_price').notNull(),
  closePrice:  real('close_price'),
  stopLoss:    real('stop_loss'),
  takeProfit:  real('take_profit'),
  openTime:    timestamp('open_time').notNull(),
  closeTime:   timestamp('close_time'),
  profit:      real('profit').notNull(),
  pips:        real('pips'),
  commission:  real('commission').notNull().default(0),
  swap:        real('swap').notNull().default(0),
  isOpen:      boolean('is_open').notNull().default(false),
  magicNumber: integer('magic_number'),
  comment:     text('comment'),
  source:      text('source').notNull().default('live'),  // "live" (broker sync) | "manual" (hand-entered / imported)
  isExcluded:  boolean('is_excluded').notNull().default(false),  // not transmitted via the public API (accounting unaffected)
}, (table) => [
  unique('trades_account_ticket_uniq').on(table.accountId, table.ticket),
  index('trades_account_close_time_idx').on(table.accountId, table.closeTime),
  index('trades_account_symbol_idx').on(table.accountId, table.symbol),
  index('trades_account_is_open_idx').on(table.accountId, table.isOpen),
  index('trades_account_source_idx').on(table.accountId, table.source),
]);

export const tradesRelations = relations(trades, ({ one, many }) => ({
  account:        one(tradingAccounts, { fields: [trades.accountId], references: [tradingAccounts.id] }),
  journalEntries: many(tradeJournal),
}));

// ─── Balance Operations ──────────────────────────────
// Deposits/withdrawals as first-class rows (captured from MetaApi
// DEAL_TYPE_BALANCE deals during sync). Stored so individual transactions can
// be hidden from API transmission; previously they were folded into snapshots
// on the fly and couldn't be referenced at all. Hidden or not, every op counts
// toward the balance curve — hiding only stops transmission.

export const balanceOps = pgTable('balance_ops', {
  id:         text('id').primaryKey().$defaultFn(() => createId()),
  accountId:  text('account_id').notNull().references(() => tradingAccounts.id, { onDelete: 'cascade' }),
  dealId:     text('deal_id').notNull(),                       // broker deal id (idempotent upsert key)
  kind:       text('kind').notNull(),                          // "deposit" | "withdrawal"
  amount:     real('amount').notNull(),                        // signed: deposits +, withdrawals −
  time:       timestamp('time').notNull(),
  comment:    text('comment'),
  isExcluded: boolean('is_excluded').notNull().default(false), // not transmitted via the public API (still counts toward balance)
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  unique('balance_ops_account_deal_uniq').on(table.accountId, table.dealId),
  index('balance_ops_account_time_idx').on(table.accountId, table.time),
]);

export const balanceOpsRelations = relations(balanceOps, ({ one }) => ({
  account: one(tradingAccounts, { fields: [balanceOps.accountId], references: [tradingAccounts.id] }),
}));

// ─── Orders ──────────────────────────────────────────
// The statement's Orders section (market + pending order records), captured on
// history import so the public API can transmit it alongside positions and
// transactions. Orders never affect balances or stats — pure distribution data.

export const orders = pgTable('orders', {
  id:            text('id').primaryKey().$defaultFn(() => createId()),
  accountId:     text('account_id').notNull().references(() => tradingAccounts.id, { onDelete: 'cascade' }),
  ticket:        text('ticket').notNull(),           // broker order id (idempotent upsert key)
  symbol:        text('symbol').notNull(),
  type:          text('type').notNull(),             // "buy" | "sell" | "buy limit" | "sell stop" | ...
  lotsRequested: real('lots_requested'),
  lotsFilled:    real('lots_filled'),
  price:         real('price'),                      // order price (null for market orders)
  stopLoss:      real('stop_loss'),
  takeProfit:    real('take_profit'),
  setupTime:     timestamp('setup_time').notNull(),  // placed (report "Open Time")
  doneTime:      timestamp('done_time'),             // reached final state (filled/canceled/expired)
  state:         text('state').notNull(),            // "filled" | "canceled" | "expired" | ...
  comment:       text('comment'),
  isExcluded:    boolean('is_excluded').notNull().default(false),  // not transmitted via the public API
  createdAt:     timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  unique('orders_account_ticket_uniq').on(table.accountId, table.ticket),
  index('orders_account_setup_time_idx').on(table.accountId, table.setupTime),
]);

export const ordersRelations = relations(orders, ({ one }) => ({
  account: one(tradingAccounts, { fields: [orders.accountId], references: [tradingAccounts.id] }),
}));

// ─── Deals ───────────────────────────────────────────
// The statement's Deals section — the broker's raw execution/balance ledger
// (entries, exits, commissions, balance operations), captured on history
// import. Like orders, pure distribution data: balances and stats stay derived
// from trades + balanceOps. The running `balance` column is stored for audit
// but never transmitted — it would betray excluded transactions.

export const deals = pgTable('deals', {
  id:          text('id').primaryKey().$defaultFn(() => createId()),
  accountId:   text('account_id').notNull().references(() => tradingAccounts.id, { onDelete: 'cascade' }),
  dealId:      text('deal_id').notNull(),          // broker deal id (idempotent upsert key)
  orderTicket: text('order_ticket'),               // originating order id, when present
  time:        timestamp('time').notNull(),
  symbol:      text('symbol'),                     // null for balance/credit deals
  type:        text('type').notNull(),             // "buy" | "sell" | "balance" | "credit" | ...
  direction:   text('direction'),                  // "in" | "out" | "in/out" | null
  lots:        real('lots'),
  price:       real('price'),
  commission:  real('commission'),
  fee:         real('fee'),
  swap:        real('swap'),
  profit:      real('profit'),
  balance:     real('balance'),                    // running balance after this deal (never exposed)
  comment:     text('comment'),
  isExcluded:  boolean('is_excluded').notNull().default(false),  // not transmitted via the public API
  createdAt:   timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  unique('deals_account_deal_uniq').on(table.accountId, table.dealId),
  index('deals_account_time_idx').on(table.accountId, table.time),
]);

export const dealsRelations = relations(deals, ({ one }) => ({
  account: one(tradingAccounts, { fields: [deals.accountId], references: [tradingAccounts.id] }),
}));

// ─── Daily Snapshots ─────────────────────────────────

export const dailySnapshots = pgTable('daily_snapshots', {
  id:         text('id').primaryKey().$defaultFn(() => createId()),
  accountId:  text('account_id').notNull().references(() => tradingAccounts.id, { onDelete: 'cascade' }),
  date:       date('date').notNull(),
  balance:    real('balance').notNull(),
  equity:     real('equity').notNull(),
  pnl:        real('pnl').notNull(),
  tradeCount: integer('trade_count').notNull(),
  winCount:   integer('win_count').notNull(),
  lossCount:  integer('loss_count').notNull(),
  volume:     real('volume').notNull(),
  pips:       real('pips').notNull().default(0),
  commission: real('commission').notNull().default(0),
  swap:       real('swap').notNull().default(0),
}, (table) => [
  unique('daily_snapshots_account_date_uniq').on(table.accountId, table.date),
  index('daily_snapshots_account_date_idx').on(table.accountId, table.date),
]);

export const dailySnapshotsRelations = relations(dailySnapshots, ({ one }) => ({
  account: one(tradingAccounts, { fields: [dailySnapshots.accountId], references: [tradingAccounts.id] }),
}));

// ─── Account Stats ───────────────────────────────────

export const accountStats = pgTable('account_stats', {
  id:                text('id').primaryKey().$defaultFn(() => createId()),
  accountId:         text('account_id').notNull().unique().references(() => tradingAccounts.id, { onDelete: 'cascade' }),
  balance:           real('balance').notNull().default(0),
  equity:            real('equity').notNull().default(0),
  totalPnl:          real('total_pnl').notNull().default(0),
  realizedPnl:       real('realized_pnl').notNull().default(0),
  unrealizedPnl:     real('unrealized_pnl').notNull().default(0),
  totalTrades:       integer('total_trades').notNull().default(0),
  winningTrades:     integer('winning_trades').notNull().default(0),
  losingTrades:      integer('losing_trades').notNull().default(0),
  winRate:           real('win_rate').notNull().default(0),
  profitFactor:      real('profit_factor').notNull().default(0),
  expectancy:        real('expectancy').notNull().default(0),
  averageWin:        real('average_win').notNull().default(0),
  averageLoss:       real('average_loss').notNull().default(0),
  riskRewardRatio:   real('risk_reward_ratio').notNull().default(0),
  maxDrawdownPct:    real('max_drawdown_pct').notNull().default(0),
  maxDrawdownAbs:    real('max_drawdown_abs').notNull().default(0),
  sharpeRatio:       real('sharpe_ratio').notNull().default(0),
  sortinoRatio:      real('sortino_ratio').notNull().default(0),
  avgTradeDuration:  integer('avg_trade_duration').notNull().default(0),
  bestTrade:         real('best_trade').notNull().default(0),
  worstTrade:        real('worst_trade').notNull().default(0),
  longestWinStreak:  integer('longest_win_streak').notNull().default(0),
  longestLossStreak: integer('longest_loss_streak').notNull().default(0),
  totalLots:         real('total_lots').notNull().default(0),
  totalPips:         real('total_pips').notNull().default(0),
  avgPipsPerTrade:   real('avg_pips_per_trade').notNull().default(0),
  bestTradePips:     real('best_trade_pips').notNull().default(0),
  worstTradePips:    real('worst_trade_pips').notNull().default(0),
  totalCommission:   real('total_commission').notNull().default(0),
  totalSwap:         real('total_swap').notNull().default(0),
  lastCalculatedAt:  timestamp('last_calculated_at').notNull().defaultNow(),
});

export const accountStatsRelations = relations(accountStats, ({ one }) => ({
  account: one(tradingAccounts, { fields: [accountStats.accountId], references: [tradingAccounts.id] }),
}));

// ─── Flex Cards ──────────────────────────────────────

export const flexCards = pgTable('flex_cards', {
  id:              text('id').primaryKey().$defaultFn(() => createId()),
  userId:          text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accountId:       text('account_id'),
  title:           text('title'),
  period:          text('period').notNull(),
  metric:          text('metric').notNull(),
  backgroundTheme: text('background_theme').notNull().default('dark-geometric'),
  customBgUrl:     text('custom_bg_url'),
  showUsername:    boolean('show_username').notNull().default(true),
  showChart:       boolean('show_chart').notNull().default(true),
  showWinLoss:     boolean('show_win_loss').notNull().default(true),
  showBranding:    boolean('show_branding').notNull().default(true),
  imageUrl:        text('image_url'),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('flex_cards_user_id_idx').on(table.userId),
]);

export const flexCardsRelations = relations(flexCards, ({ one }) => ({
  user: one(users, { fields: [flexCards.userId], references: [users.id] }),
}));

// ─── User Roles (access control) ──────────────────

export const userRoles = pgTable('user_roles', {
  id:        text('id').primaryKey().$defaultFn(() => createId()),
  userId:    text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role:      text('role').notNull(),               // "admin" | "signals" | "journal"
  grantedBy: text('granted_by').references(() => users.id),
  grantedAt: timestamp('granted_at').notNull().defaultNow(),
}, (table) => [
  unique('user_roles_user_role_uniq').on(table.userId, table.role),
]);

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user:    one(users, { fields: [userRoles.userId], references: [users.id] }),
  granter: one(users, { fields: [userRoles.grantedBy], references: [users.id], relationName: 'grantedRoles' }),
}));

// ─── API Keys (programmatic ingest/distribute auth) ──
// Per-user keys for the public REST API (/api/v1/*). The plaintext key is shown
// once at creation and never stored — only its SHA-256 hash. `prefix` is a short,
// non-secret identifier shown in the UI so a key can be recognised/revoked.

export const apiKeys = pgTable('api_keys', {
  id:         text('id').primaryKey().$defaultFn(() => createId()),
  userId:     text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:       text('name').notNull(),
  prefix:     text('prefix').notNull(),                      // e.g. "hk_a1b2c3" (non-secret display id)
  keyHash:    text('key_hash').notNull().unique(),           // sha256(plaintext key), hex
  scopes:     text('scopes').notNull().default('read'),      // comma-separated: "read", "write"
  // Account restriction: null = all of the user's accounts (incl. future ones);
  // an array = only these account ids. Out-of-scope accounts 404 to the caller.
  accountIds: jsonb('account_ids').$type<string[] | null>(),
  lastUsedAt: timestamp('last_used_at'),
  expiresAt:  timestamp('expires_at'),
  revokedAt:  timestamp('revoked_at'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('api_keys_user_id_idx').on(table.userId),
  index('api_keys_key_hash_idx').on(table.keyHash),
]);

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, { fields: [apiKeys.userId], references: [users.id] }),
}));

// ─── Signal Sources ───────────────────────────────

export const signalSources = pgTable('signal_sources', {
  id:                   text('id').primaryKey().$defaultFn(() => createId()),
  userId:               text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:                 text('name').notNull(),
  telegramChannelId:    text('telegram_channel_id'),
  telegramChannelName:  text('telegram_channel_name'),
  telegramSession:      text('telegram_session'),          // GramJS session string for reconnection
  telegramPhone:        text('telegram_phone'),             // Phone number used for auth
  telegramStatus:       text('telegram_status').notNull().default('disconnected'), // "connected" | "awaiting_code" | "awaiting_2fa" | "disconnected" | "error"
  priceFeed:            text('price_feed').notNull(),     // "CME" | "BLACKBULL"
  isActive:             boolean('is_active').notNull().default(true),
  createdAt:            timestamp('created_at').notNull().defaultNow(),
  updatedAt:            timestamp('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index('signal_sources_user_id_idx').on(table.userId),
]);

export const signalSourcesRelations = relations(signalSources, ({ one, many }) => ({
  user:    one(users, { fields: [signalSources.userId], references: [users.id] }),
  configs: many(signalConfigs),
  signals: many(signals),
}));

// ─── Signal Configs ───────────────────────────────

export const signalConfigs = pgTable('signal_configs', {
  id:        text('id').primaryKey().$defaultFn(() => createId()),
  userId:    text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sourceId:  text('source_id').notNull().references(() => signalSources.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull().references(() => tradingAccounts.id, { onDelete: 'cascade' }),

  // Master controls
  isEnabled: boolean('is_enabled').notNull().default(false),
  dryRun:    boolean('dry_run').notNull().default(true),

  // Instrument-specific execution symbols
  nqSymbol: text('nq_symbol').notNull().default('NAS100'),
  esSymbol: text('es_symbol').notNull().default('US500'),

  // Size → lot mapping (per instrument)
  nqSmallLots:  real('nq_small_lots').notNull().default(0.01),
  nqMediumLots: real('nq_medium_lots').notNull().default(0.05),
  nqLargeLots:  real('nq_large_lots').notNull().default(0.10),
  esSmallLots:  real('es_small_lots').notNull().default(0.01),
  esMediumLots: real('es_medium_lots').notNull().default(0.05),
  esLargeLots:  real('es_large_lots').notNull().default(0.10),

  // Offset settings (per instrument)
  offsetMode:    text('offset_mode').notNull().default('webhook'),   // "webhook" | "fixed" | "none"
  nqFixedOffset: real('nq_fixed_offset').notNull().default(198),
  esFixedOffset: real('es_fixed_offset').notNull().default(40),
  nqMaxOffset:   real('nq_max_offset').notNull().default(400),
  nqMinOffset:   real('nq_min_offset').notNull().default(50),
  esMaxOffset:   real('es_max_offset').notNull().default(150),
  esMinOffset:   real('es_min_offset').notNull().default(10),

  // Position sizing
  sizingMode:       text('sizing_mode').notNull().default('strict'),        // "strict" | "percent_balance" | "percent_equity"
  executionMode:    text('execution_mode').notNull().default('single'),     // "single" | "split_target"
  baseRiskPercent:  real('base_risk_percent').notNull().default(1.0),
  maxRiskPercent:   real('max_risk_percent').notNull().default(5.0),
  minStopDistance:  real('min_stop_distance').notNull().default(10),
  maxLotSize:       real('max_lot_size').notNull().default(0.10),

  // Size tier multipliers (for percent modes)
  smallMultiplier:  real('small_multiplier').notNull().default(0.5),
  mediumMultiplier: real('medium_multiplier').notNull().default(1.0),
  largeMultiplier:  real('large_multiplier').notNull().default(1.5),

  // Order settings
  maxLotsPerOrder:       real('max_lots_per_order').notNull().default(50),
  marketOrderThreshold:  real('market_order_threshold').notNull().default(5.0),
  maxSlippage:           real('max_slippage').notNull().default(5.0),

  // Margin safety
  marginWarningThreshold: real('margin_warning_threshold').notNull().default(80),
  marginRejectThreshold:  real('margin_reject_threshold').notNull().default(95),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  unique('signal_configs_source_account_uniq').on(table.sourceId, table.accountId),
  index('signal_configs_user_id_idx').on(table.userId),
  index('signal_configs_source_id_idx').on(table.sourceId),
  index('signal_configs_account_id_idx').on(table.accountId),
]);

export const signalConfigsRelations = relations(signalConfigs, ({ one, many }) => ({
  user:       one(users, { fields: [signalConfigs.userId], references: [users.id] }),
  source:     one(signalSources, { fields: [signalConfigs.sourceId], references: [signalSources.id] }),
  account:    one(tradingAccounts, { fields: [signalConfigs.accountId], references: [tradingAccounts.id] }),
  executions: many(signalExecutions),
}));

// ─── Signals ──────────────────────────────────────

export const signals = pgTable('signals', {
  id:       text('id').primaryKey().$defaultFn(() => createId()),
  sourceId: text('source_id').notNull().references(() => signalSources.id, { onDelete: 'cascade' }),

  // Raw data
  telegramMessageId: integer('telegram_message_id'),
  rawMessage:        text('raw_message').notNull(),
  receivedAt:        timestamp('received_at').notNull().defaultNow(),

  // Parsed result
  messageType: text('message_type').notNull(),       // "signals" | "cancellation" | "tp_hit" | "unknown"
  parsed:      boolean('parsed').notNull().default(false),
  signalCount: integer('signal_count').notNull().default(0),
  warning:     text('warning'),
  parseError:  text('parse_error'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('signals_source_id_idx').on(table.sourceId),
  index('signals_received_at_idx').on(table.receivedAt),
  unique('signals_source_message_uniq').on(table.sourceId, table.telegramMessageId),
]);

export const signalsRelations = relations(signals, ({ one, many }) => ({
  source:     one(signalSources, { fields: [signals.sourceId], references: [signalSources.id] }),
  executions: many(signalExecutions),
}));

// ─── Signal Executions ────────────────────────────

export const signalExecutions = pgTable('signal_executions', {
  id:        text('id').primaryKey().$defaultFn(() => createId()),
  signalId:  text('signal_id').notNull().references(() => signals.id, { onDelete: 'cascade' }),
  configId:  text('config_id').notNull().references(() => signalConfigs.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull().references(() => tradingAccounts.id, { onDelete: 'cascade' }),

  // Signal data
  tradeNumber:       integer('trade_number'),
  splitIndex:        integer('split_index'),
  linkedExecutionId: text('linked_execution_id'),
  chunkIndex:        integer('chunk_index'),
  totalChunks:       integer('total_chunks'),
  instrument:        text('instrument').notNull(),        // "NQ" | "ES"
  fusionSymbol:      text('fusion_symbol').notNull(),     // "NAS100" | "US500"
  direction:         text('direction').notNull(),          // "LONG" | "SHORT"
  signalEntry:       real('signal_entry').notNull(),
  signalSl:          real('signal_sl').notNull(),
  signalTp1:         real('signal_tp1').notNull(),
  signalTp2:         real('signal_tp2').notNull(),
  signalSize:        text('signal_size').notNull(),        // "Small" | "Medium" | "Large"
  lotSize:           real('lot_size').notNull(),

  // Offset
  futuresPriceAtExec: real('futures_price_at_exec'),
  fusionPriceAtExec:  real('fusion_price_at_exec'),
  offsetApplied:      real('offset_applied'),
  offsetIsStale:      boolean('offset_is_stale').notNull().default(false),

  // Adjusted levels (after offset)
  adjustedEntry: real('adjusted_entry'),
  adjustedSl:    real('adjusted_sl'),
  adjustedTp1:   real('adjusted_tp1'),
  adjustedTp2:   real('adjusted_tp2'),

  // Order decision
  orderType:   text('order_type'),       // "MARKET" | "BUY_STOP" | "BUY_LIMIT" | "SELL_STOP" | "SELL_LIMIT"
  orderReason: text('order_reason'),

  // Execution result
  status:          text('status').notNull(),     // "pending" | "sent" | "filled" | "cancelled" | "rejected" | "error" | "dry_run"
  metaapiOrderId:  text('metaapi_order_id'),
  fillPrice:       real('fill_price'),
  slippage:        real('slippage'),
  errorMessage:    text('error_message'),

  // Timing
  signalReceivedAt: timestamp('signal_received_at'),
  orderSentAt:      timestamp('order_sent_at'),
  orderFilledAt:    timestamp('order_filled_at'),
  totalLatencyMs:   integer('total_latency_ms'),

  // Split target tracking
  breakevenMovedAt: timestamp('breakeven_moved_at'),

  isDryRun:  boolean('is_dry_run').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('signal_executions_signal_id_idx').on(table.signalId),
  index('signal_executions_account_id_idx').on(table.accountId),
  index('signal_executions_status_idx').on(table.status),
  index('signal_executions_instrument_idx').on(table.instrument),
  index('signal_executions_linked_execution_id_idx').on(table.linkedExecutionId),
]);

export const signalExecutionsRelations = relations(signalExecutions, ({ one }) => ({
  signal:          one(signals, { fields: [signalExecutions.signalId], references: [signals.id] }),
  config:          one(signalConfigs, { fields: [signalExecutions.configId], references: [signalConfigs.id] }),
  account:         one(tradingAccounts, { fields: [signalExecutions.accountId], references: [tradingAccounts.id] }),
  linkedExecution: one(signalExecutions, { fields: [signalExecutions.linkedExecutionId], references: [signalExecutions.id], relationName: 'linkedPair' }),
}));

// ─── Offset History (from TradingView Webhooks) ──

export const offsetHistory = pgTable('offset_history', {
  id:                    text('id').primaryKey().$defaultFn(() => createId()),
  nqOffset:              real('nq_offset').notNull(),
  esOffset:              real('es_offset').notNull(),
  nqFuturesPrice:        real('nq_futures_price').notNull(),
  esFuturesPrice:        real('es_futures_price').notNull(),
  nas100Price:            real('nas100_price').notNull(),
  us500Price:             real('us500_price').notNull(),
  nqOffsetSma:           real('nq_offset_sma'),
  esOffsetSma:           real('es_offset_sma'),
  tradingviewTimestamp:  text('tradingview_timestamp'),
  receivedAt:            timestamp('received_at').notNull().defaultNow(),
}, (table) => [
  index('offset_history_received_at_idx').on(table.receivedAt),
]);

// ─── Trade Journal ────────────────────────────────

export const tradeJournal = pgTable('trade_journal', {
  id:                text('id').primaryKey().$defaultFn(() => createId()),
  userId:            text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tradeId:           text('trade_id').references(() => trades.id, { onDelete: 'set null' }),
  signalExecutionId: text('signal_execution_id').references(() => signalExecutions.id, { onDelete: 'set null' }),

  // Journal content
  setupType:      text('setup_type'),
  reasoning:      text('reasoning'),
  review:         text('review'),
  emotionalState: text('emotional_state'),
  rating:         integer('rating'),
  tags:           text('tags'),                // JSON array
  screenshotUrls: text('screenshot_urls'),     // JSON array

  // Denormalized for fast queries
  symbol:    text('symbol'),
  direction: text('direction'),
  pnl:       real('pnl'),
  pnlPips:   real('pnl_pips'),
  entryTime: timestamp('entry_time'),
  exitTime:  timestamp('exit_time'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index('trade_journal_user_id_idx').on(table.userId),
  index('trade_journal_setup_type_idx').on(table.setupType),
  index('trade_journal_entry_time_idx').on(table.entryTime),
]);

export const tradeJournalRelations = relations(tradeJournal, ({ one }) => ({
  user:            one(users, { fields: [tradeJournal.userId], references: [users.id] }),
  trade:           one(trades, { fields: [tradeJournal.tradeId], references: [trades.id] }),
  signalExecution: one(signalExecutions, { fields: [tradeJournal.signalExecutionId], references: [signalExecutions.id] }),
}));

// ─── HITL Sessions (human-in-the-loop execution) ──
// Durable, never hard-deleted — only ever transitioned through the state
// machine (see HITL_DESIGN.md §5). One row per TradingView alert that enters
// the approval flow.

export type HitlLeg = {
  leg: 'A' | 'B';
  tp: number;            // take-profit target for this leg (TP2 for A, TP3 for B)
  volume: number;
  clientId: string;      // haia-hitl-{signalId}-{legA|legB}
  ticket: string | null; // MetaApi position id once filled
  status: 'pending' | 'open' | 'closed' | 'failed';
};

export const hitlSessions = pgTable('hitl_sessions', {
  id:         text('id').primaryKey().$defaultFn(() => createId()),
  signalId:   text('signal_id').notNull().unique(),                 // correlation key; order clientId = haia-hitl-{signalId}-{legA|legB}
  accountId:  text('account_id').references(() => tradingAccounts.id, { onDelete: 'set null' }), // resolved from hitlEnabled; kept for audit

  symbol:     text('symbol').notNull(),
  action:     text('action'),                                       // "BUY" | "SELL" | null until AWAITING_DIRECTION resolved
  state:      text('state').notNull().default('RECEIVED'),          // state machine (§5)

  // ── inputs ──
  entryRef:   real('entry_ref'),
  rangeHigh:  real('range_high'),
  rangeLow:   real('range_low'),
  rawAlert:   jsonb('raw_alert').$type<Record<string, unknown>>(),

  // ── computed (gated by SL_FROM=range_size) ──
  direction:  text('direction'),                                    // "BUY" | "SELL"
  sl:         real('sl'),
  r:          real('r'),
  tp1:        real('tp1'),
  tp2:        real('tp2'),
  tp3:        real('tp3'),
  lots:       real('lots'),
  legs:       jsonb('legs').$type<HitlLeg[]>(),

  // ── config snapshot (audit) ──
  slFrom:        text('sl_from'),
  positionModel: text('position_model'),
  entryMode:     text('entry_mode'),
  riskPct:       real('risk_pct'),

  // ── telegram ──
  operatorChatId:   text('operator_chat_id'),
  promptMessageId:  text('prompt_message_id'),
  promptMessageIds: jsonb('prompt_message_ids').$type<number[]>(),  // prompt msg ids across all chats (reply routing)
  confirmMessageId: text('confirm_message_id'),

  // ── lifecycle ──
  beRequested:   boolean('be_requested').notNull().default(false),  // set by /tp1-hit webhook; worker acts on it
  beRequestedAt: timestamp('be_requested_at'),
  beApplied:     boolean('be_applied').notNull().default(false),
  beAppliedAt:   timestamp('be_applied_at'),
  dispatchedAt:  timestamp('dispatched_at'),
  realizedPnl:   real('realized_pnl'),
  failureReason: text('failure_reason'),

  receivedAt:      timestamp('received_at').notNull().defaultNow(),
  rangeReceivedAt: timestamp('range_received_at'),
  approvedAt:      timestamp('approved_at'),
  closedAt:        timestamp('closed_at'),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index('hitl_sessions_state_idx').on(table.state),
  index('hitl_sessions_symbol_idx').on(table.symbol),
  index('hitl_sessions_account_id_idx').on(table.accountId),
]);

export const hitlSessionsRelations = relations(hitlSessions, ({ one }) => ({
  account: one(tradingAccounts, { fields: [hitlSessions.accountId], references: [tradingAccounts.id] }),
}));

// ─── HITL Symbol Map (TradingView ticker → broker symbol) ──
// Operator-level config (global, like offsetHistory). Editable from Settings;
// resolved at webhook intake. Identity unless a row overrides.

export const hitlSymbolMaps = pgTable('hitl_symbol_maps', {
  id:           text('id').primaryKey().$defaultFn(() => createId()),
  tvSymbol:     text('tv_symbol').notNull().unique(),   // stored uppercase
  brokerSymbol: text('broker_symbol').notNull(),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
});

// ─── HITL Access (operator-level, in-app managed) ──
// Who may respond to / approve HITL prompts. Merged with the AUTHORIZED_TELEGRAM_USER_IDS
// env seed; DB rows are live (no redeploy). Not secret — secrets stay in env.

export const hitlAuthorizedUsers = pgTable('hitl_authorized_users', {
  id:             text('id').primaryKey().$defaultFn(() => createId()),
  telegramUserId: text('telegram_user_id').notNull().unique(),  // numeric id as text
  label:          text('label'),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
});

// Operator destinations — where prompts/confirm cards/notifications are sent.
// A DM (positive chat id) and/or group(s) (negative). Prompts fan out to all;
// the operator can reply/approve from any. Merged with the HITL_OPERATOR_CHAT_ID
// env seed.
export const hitlChats = pgTable('hitl_chats', {
  id:        text('id').primaryKey().$defaultFn(() => createId()),
  chatId:    text('chat_id').notNull().unique(),   // numeric Telegram chat id (groups are negative)
  label:     text('label'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Singleton key/value config for HITL (e.g. TP R-multiples).
export const hitlSettings = pgTable('hitl_settings', {
  key:       text('key').primaryKey(),
  value:     text('value').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
});
