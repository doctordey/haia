import { pgTable, text, boolean, integer, real, timestamp, date, unique, index } from 'drizzle-orm/pg-core';
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
  accounts: many(tradingAccounts),
  sessions: many(sessions),
  flexCards: many(flexCards),
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
}, (table) => [
  unique('trades_account_ticket_uniq').on(table.accountId, table.ticket),
  index('trades_account_close_time_idx').on(table.accountId, table.closeTime),
  index('trades_account_symbol_idx').on(table.accountId, table.symbol),
  index('trades_account_is_open_idx').on(table.accountId, table.isOpen),
]);

export const tradesRelations = relations(trades, ({ one }) => ({
  account: one(tradingAccounts, { fields: [trades.accountId], references: [tradingAccounts.id] }),
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
