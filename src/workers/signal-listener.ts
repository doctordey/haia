/**
 * Signal Listener Worker
 *
 * Runs as a separate process: npx tsx src/workers/signal-listener.ts
 *
 * Connects to:
 *  1. Telegram (MTProto) — listens for signal messages
 *  2. MetaApi (WebSocket) — streams NAS100 + US500 CFD prices
 *  3. Offset data comes from TradingView webhook → POST /api/signals/offset/webhook
 *
 * On new signal: parses → offsets → sizes → executes via MetaApi
 */

import { db } from '../lib/db';
import {
  signalSources,
  signalConfigs,
  signals,
  signalExecutions,
  tradingAccounts,
  offsetHistory,
  tradeJournal,
} from '../lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { TelegramSignalClient } from '../lib/signals/telegram';
import { PriceCache, type CachedOffset } from '../lib/signals/price-cache';
import { parseSignalMessage } from '../lib/signals/parser';
import { executePipeline } from '../lib/signals/execute';
import { handleCancellation } from '../lib/signals/cancel';
import { onPositionClosed } from '../lib/signals/breakeven';
import type { SignalConfig, MetaApiTradeInterface } from '../types/signals';

// ─── Globals ──────────────────────────────────────────

const priceCache = new PriceCache();
let telegramClient: TelegramSignalClient | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const accountConnections = new Map<string, { streaming: any; rpc: any }>(); // accountId → connections
let isShuttingDown = false;

// ─── MetaApi Price Streaming ──────────────────────────

async function startPriceStreaming(accountId: string, metaApiId: string): Promise<void> {
  if (accountConnections.has(accountId)) return; // Already connected

  console.log(`[worker] Starting MetaApi streaming for account ${accountId} (${metaApiId})...`);

  const MetaApi = require('metaapi.cloud-sdk').default;
  const api = new MetaApi(process.env.METAAPI_TOKEN);
  const account = await api.metatraderAccountApi.getAccount(metaApiId);

  if (account.state !== 'DEPLOYED') {
    console.log(`[metaapi:${accountId}] Waiting for deployment...`);
    await account.waitDeployed();
  }

  if (account.connectionStatus !== 'CONNECTED') {
    console.log(`[metaapi:${accountId}] Waiting for broker connection...`);
    await account.waitConnected();
  }

  const connection = account.getStreamingConnection();

  // Base no-op stubs for all SDK listener methods (avoids 'is not a function' errors)
  const noopListener: Record<string, (...args: unknown[]) => void> = {};
  const listenerMethods = [
    'onAccountInformationUpdated', 'onBooksUpdated', 'onBrokerConnectionStatusChanged',
    'onCandlesUpdated', 'onConnected', 'onDealAdded', 'onDealsSynchronized',
    'onDisconnected', 'onHealthStatus', 'onHistoryOrderAdded', 'onHistoryOrdersSynchronized',
    'onPendingOrderCompleted', 'onPendingOrderUpdated', 'onPendingOrdersReplaced',
    'onPendingOrdersSynchronized', 'onPendingOrdersUpdated', 'onPositionRemoved',
    'onPositionUpdated', 'onPositionsReplaced', 'onPositionsSynchronized', 'onPositionsUpdated',
    'onStreamClosed', 'onSubscriptionDowngraded', 'onSymbolPriceUpdated', 'onSymbolPricesUpdated',
    'onSymbolSpecificationRemoved', 'onSymbolSpecificationUpdated', 'onSymbolSpecificationsUpdated',
    'onSynchronizationStarted', 'onTicksUpdated', 'onUnsubscribeRegion',
  ];
  for (const method of listenerMethods) {
    noopListener[method] = () => {};
  }

  connection.addSynchronizationListener({
    ...noopListener,
    // Override the methods we care about
    onSymbolPriceUpdated(_instanceIndex: string, price: { symbol: string; bid: number; ask: number }) {
      if (price.symbol === 'NAS100' || price.symbol === 'US500') {
        priceCache.setPrice(price.symbol, price.bid, price.ask);
      }
    },
    onSymbolPricesUpdated(_instanceIndex: string, prices: { symbol: string; bid: number; ask: number }[]) {
      for (const price of prices) {
        if (price.symbol === 'NAS100' || price.symbol === 'US500') {
          priceCache.setPrice(price.symbol, price.bid, price.ask);
        }
      }
    },
    onConnected() { console.log(`[metaapi:${accountId}] Connected`); },
    onDisconnected() { console.log(`[metaapi:${accountId}] Disconnected — will auto-reconnect`); },
    onBrokerConnectionStatusChanged(_i: string, connected: boolean) {
      console.log(`[metaapi:${accountId}] Broker: ${connected ? 'connected' : 'disconnected'}`);
    },
    onDealAdded(_instanceIndex: string, deal: { positionId?: string; type?: string; entryType?: string; profit?: number }) {
      if (deal.entryType === 'DEAL_ENTRY_OUT' && deal.positionId) {
        const wasTPHit = (deal.profit ?? 0) > 0;
        handlePositionClosed(deal.positionId, wasTPHit, accountId);
      }
    },
  });

  await connection.connect();
  await connection.waitSynchronized({ timeoutInSeconds: 120 });

  try {
    await connection.subscribeToMarketData('NAS100');
    await connection.subscribeToMarketData('US500');
    console.log(`[worker] Streaming active for account ${accountId}`);
  } catch (error) {
    console.warn(`[metaapi:${accountId}] Market data subscription failed:`, error instanceof Error ? error.message : error);
  }

  // Also create an RPC connection for trading operations
  const rpcConnection = account.getRPCConnection();
  await rpcConnection.connect();
  await rpcConnection.waitSynchronized();
  console.log(`[metaapi:${accountId}] RPC connection ready`);

  accountConnections.set(accountId, { streaming: connection, rpc: rpcConnection });

  console.log(`[worker] Connections ready for account ${accountId}`);
}

async function handlePositionClosed(positionId: string, wasTPHit: boolean, accountId: string): Promise<void> {
  const conns = accountConnections.get(accountId);
  if (!conns?.rpc) return;

  try {
    const metaApi = buildMetaApiInterface(conns.rpc);
    const result = await onPositionClosed(positionId, wasTPHit, metaApi);
    if (result?.action === 'breakeven_moved') {
      console.log(`[breakeven] Moved TP2 SL to entry for position ${positionId}`);
    }
  } catch (error) {
    console.error(`[breakeven] Error handling position close ${positionId}:`, error);
  }
}

// ─── Offset Bootstrap ─────────────────────────────────

async function loadLastOffset(): Promise<void> {
  try {
    const [latest] = await db
      .select()
      .from(offsetHistory)
      .orderBy(desc(offsetHistory.receivedAt))
      .limit(1);

    if (latest) {
      const offsetData: CachedOffset = {
        nqOffset: latest.nqOffset,
        esOffset: latest.esOffset,
        nqFuturesPrice: latest.nqFuturesPrice,
        esFuturesPrice: latest.esFuturesPrice,
        nas100Price: latest.nas100Price,
        us500Price: latest.us500Price,
        nqOffsetSma: latest.nqOffsetSma ?? 0,
        esOffsetSma: latest.esOffsetSma ?? 0,
        receivedAt: latest.receivedAt.getTime(),
        tradingviewTimestamp: latest.tradingviewTimestamp ?? '',
      };
      priceCache.setOffset(offsetData);
      const ageMinutes = ((Date.now() - latest.receivedAt.getTime()) / 60000).toFixed(0);
      console.log(
        `[worker] Loaded last offset from DB: NQ=${latest.nqOffset.toFixed(2)} ES=${latest.esOffset.toFixed(2)} (${ageMinutes}m old)`,
      );
    } else {
      console.warn('[worker] No offset history in DB — using fixed fallback until TradingView webhook fires');
    }
  } catch (error) {
    console.error('[worker] Failed to load offset history:', error);
  }
}

// ─── Telegram Listener ────────────────────────────────

async function startTelegramListener(
  source: typeof signalSources.$inferSelect,
): Promise<void> {
  if (!source.telegramSession) {
    console.warn('[telegram] Source missing session — skipping');
    return;
  }

  if (!source.telegramChannelId) {
    console.log('[telegram] No channel ID set — starting in auto-detect mode (will listen to all channels)');
  }

  const apiId = parseInt(process.env.TELEGRAM_API_ID || '0');
  const apiHash = process.env.TELEGRAM_API_HASH || '';

  if (!apiId || !apiHash) {
    console.error('[telegram] TELEGRAM_API_ID and TELEGRAM_API_HASH not set');
    return;
  }

  telegramClient = new TelegramSignalClient(apiId, apiHash, source.telegramSession);
  await telegramClient.connect();

  const authorized = await telegramClient.isAuthorized();
  if (!authorized) {
    console.error('[telegram] Session expired — re-authentication required');
    await db
      .update(signalSources)
      .set({ telegramStatus: 'disconnected' })
      .where(eq(signalSources.id, source.id));
    return;
  }

  console.log(`[telegram] Authenticated. Listening to channel: ${source.telegramChannelName || source.telegramChannelId}`);

  telegramClient.listenToChannel(source.telegramChannelId, async (text, messageId, chatId) => {
    // Auto-update the channel ID if it was empty or different (auto-detect)
    if (chatId && source.telegramChannelId !== chatId) {
      console.log(`[telegram] Auto-detected channel ID: ${chatId} (was: ${source.telegramChannelId || 'empty'})`);
      await db
        .update(signalSources)
        .set({ telegramChannelId: chatId })
        .where(eq(signalSources.id, source.id))
        .catch(() => {});
      source.telegramChannelId = chatId;
    }

    await handleTelegramMessageMulti(text, messageId, source);
  });

  await db
    .update(signalSources)
    .set({ telegramStatus: 'connected' })
    .where(eq(signalSources.id, source.id));
}

// ─── Multi-Account Dispatch ───────────────────────────

async function handleTelegramMessageMulti(
  text: string,
  messageId: number,
  source: typeof signalSources.$inferSelect,
): Promise<void> {
  // Re-read configs from DB each time to pick up enable/disable changes
  const configs = await db.query.signalConfigs.findMany({
    where: and(eq(signalConfigs.sourceId, source.id), eq(signalConfigs.isEnabled, true)),
  });

  if (configs.length === 0) {
    console.log(`[signal] No enabled configs for source ${source.name} — skipping`);
    return;
  }

  console.log(`[signal] Dispatching to ${configs.length} account(s)`);

  // Execute on each account in parallel
  await Promise.all(
    configs.map(async (config) => {
      const account = await db.query.tradingAccounts.findFirst({
        where: eq(tradingAccounts.id, config.accountId),
      });
      if (!account) {
        console.warn(`[signal] Account ${config.accountId} not found for config ${config.id}`);
        return;
      }

      // Ensure this account has a streaming connection
      if (!accountConnections.has(account.id) && !config.dryRun) {
        try {
          await startPriceStreaming(account.id, account.metaApiId);
        } catch (err) {
          console.error(`[signal] Failed to connect account ${account.name}:`, err);
        }
      }

      try {
        await handleTelegramMessage(text, messageId, source, config, account);
      } catch (err) {
        console.error(`[signal] Error executing on account ${account.name}:`, err);
      }
    }),
  );
}

// ─── Message Handler (single account) ─────────────────

async function handleTelegramMessage(
  text: string,
  messageId: number,
  source: typeof signalSources.$inferSelect,
  config: typeof signalConfigs.$inferSelect,
  account: typeof tradingAccounts.$inferSelect,
): Promise<void> {
  const startTime = Date.now();
  console.log(`[signal] Received message #${messageId} (${text.slice(0, 60)}...)`);

  const parsed = parseSignalMessage(text);

  // Store raw signal
  const [signalRow] = await db
    .insert(signals)
    .values({
      sourceId: source.id,
      telegramMessageId: messageId,
      rawMessage: text,
      messageType: parsed.type,
      parsed: parsed.type !== 'unknown',
      signalCount: parsed.type === 'signals' ? parsed.signals.length : 0,
      warning: parsed.type === 'signals' ? parsed.warning : undefined,
    })
    .returning();

  if (!config.isEnabled) {
    console.log('[signal] Pipeline disabled — stored raw message only');
    return;
  }

  // Contract roll detection — auto-pause
  if (priceCache.contractRollDetected) {
    console.error(`[signal] CONTRACT ROLL DETECTED — pipeline auto-paused: ${priceCache.contractRollMessage}`);
    try {
      await db
        .update(signalConfigs)
        .set({ isEnabled: false })
        .where(eq(signalConfigs.id, config.id));
    } catch {}
    return;
  }

  switch (parsed.type) {
    case 'signals': {
      console.log(`[signal] Parsed ${parsed.signals.length} signals${parsed.warning ? ` (warning: ${parsed.warning})` : ''}`);

      const signalConfig = buildSignalConfig(config);
      const accountInfo = {
        balance: 10000,
        equity: 10000,
      };

      // Get live account info from MetaApi (account-specific connections)
      const conns = accountConnections.get(account.id);
      if (conns?.rpc) {
        try {
          const info = await conns.rpc.getAccountInformation();
          accountInfo.balance = info.balance;
          accountInfo.equity = info.equity;
        } catch (err) {
          // Fall back to streaming terminal state
          try {
            const tsInfo = conns.streaming.terminalState.accountInformation;
            if (tsInfo) {
              accountInfo.balance = tsInfo.balance;
              accountInfo.equity = tsInfo.equity;
            }
          } catch {}
          console.warn(`[signal:${account.name}] Could not fetch live account info, using cached`);
        }
      }

      const metaApi = conns?.rpc ? buildMetaApiInterface(conns.rpc) : buildDryRunMetaApi();

      const results = await executePipeline(
        text,
        signalRow.id,
        signalConfig,
        priceCache,
        accountInfo,
        metaApi,
      );

      // Persist execution results and collect IDs
      const insertedExecutionIds: { id: string; instrument: string; direction: string; fusionSymbol: string; splitIndex: number | null; chunkIndex: number | null; signalReceivedAt: Date | null }[] = [];
      for (const result of results) {
        const [inserted] = await db.insert(signalExecutions).values({
          signalId: signalRow.id,
          configId: config.id,
          accountId: account.id,
          tradeNumber: result.tradeNumber,
          splitIndex: result.splitIndex,
          linkedExecutionId: result.linkedExecutionId,
          chunkIndex: result.chunkIndex,
          totalChunks: result.totalChunks,
          instrument: result.instrument,
          fusionSymbol: result.fusionSymbol,
          direction: result.direction,
          signalEntry: result.signalEntry,
          signalSl: result.signalSl,
          signalTp1: result.signalTp1,
          signalTp2: result.signalTp2,
          signalSize: result.signalSize,
          lotSize: result.lotSize,
          futuresPriceAtExec: result.futuresPriceAtExec,
          fusionPriceAtExec: result.fusionPriceAtExec,
          offsetApplied: result.offsetApplied,
          offsetIsStale: result.offsetIsStale,
          adjustedEntry: result.adjustedEntry,
          adjustedSl: result.adjustedSl,
          adjustedTp1: result.adjustedTp1,
          adjustedTp2: result.adjustedTp2,
          orderType: result.orderType,
          orderReason: result.orderReason,
          status: result.status,
          metaapiOrderId: result.metaapiOrderId,
          fillPrice: result.fillPrice,
          slippage: result.slippage,
          errorMessage: result.errorMessage,
          signalReceivedAt: result.signalReceivedAt,
          orderSentAt: result.orderSentAt,
          orderFilledAt: result.orderFilledAt,
          totalLatencyMs: result.totalLatencyMs,
          isDryRun: result.isDryRun,
        }).returning();
        insertedExecutionIds.push({
          id: inserted.id,
          instrument: result.instrument,
          direction: result.direction,
          fusionSymbol: result.fusionSymbol,
          splitIndex: result.splitIndex,
          chunkIndex: result.chunkIndex,
          signalReceivedAt: result.signalReceivedAt,
        });
      }

      // Auto-create journal entries for primary executions (not chunks/TP2)
      const primaryExecs = insertedExecutionIds.filter(
        (e) => (e.splitIndex === null || e.splitIndex === 1) && (e.chunkIndex === null || e.chunkIndex === 1),
      );
      for (const exec of primaryExecs) {
        try {
          await db.insert(tradeJournal).values({
            userId: source.userId,
            signalExecutionId: exec.id,
            setupType: 'signal_copy',
            symbol: exec.fusionSymbol,
            direction: exec.direction,
            entryTime: exec.signalReceivedAt,
          });
        } catch (err) {
          console.warn('[journal] Failed to auto-create journal entry:', err);
        }
      }

      const latency = Date.now() - startTime;
      const statuses = results.map((r) => r.status).join(', ');
      console.log(`[signal] Executed ${results.length} orders [${statuses}] in ${latency}ms`);
      break;
    }

    case 'cancellation': {
      console.log(`[signal:${account.name}] Cancellation: ${parsed.cancellation.type}`);
      const cancelConns = accountConnections.get(account.id);
      if (cancelConns?.rpc) {
        const metaApi = buildMetaApiInterface(cancelConns.rpc);
        const results = await handleCancellation(parsed, config.id, metaApi);
        console.log(`[signal:${account.name}] Cancellation results: ${results.map((r) => `${r.executionId}=${r.status}`).join(', ')}`);
      }
      break;
    }

    case 'tp_hit': {
      console.log(`[signal] TP hit: ${parsed.hits.map((h) => `${h.instrument} ${h.tpLevel}`).join(', ')}`);
      break;
    }

    case 'unknown': {
      console.log(`[signal] Unknown message type — stored raw`);
      break;
    }
  }
}

// ─── Helpers ──────────────────────────────────────────

function buildSignalConfig(row: typeof signalConfigs.$inferSelect): SignalConfig {
  return {
    id: row.id,
    isEnabled: row.isEnabled,
    dryRun: row.dryRun,
    nqSymbol: row.nqSymbol,
    esSymbol: row.esSymbol,
    nqSmallLots: row.nqSmallLots,
    nqMediumLots: row.nqMediumLots,
    nqLargeLots: row.nqLargeLots,
    esSmallLots: row.esSmallLots,
    esMediumLots: row.esMediumLots,
    esLargeLots: row.esLargeLots,
    offsetMode: row.offsetMode as SignalConfig['offsetMode'],
    nqFixedOffset: row.nqFixedOffset,
    esFixedOffset: row.esFixedOffset,
    nqMaxOffset: row.nqMaxOffset,
    nqMinOffset: row.nqMinOffset,
    esMaxOffset: row.esMaxOffset,
    esMinOffset: row.esMinOffset,
    sizingMode: row.sizingMode as SignalConfig['sizingMode'],
    executionMode: row.executionMode as SignalConfig['executionMode'],
    baseRiskPercent: row.baseRiskPercent,
    maxRiskPercent: row.maxRiskPercent,
    minStopDistance: row.minStopDistance,
    maxLotSize: row.maxLotSize,
    smallMultiplier: row.smallMultiplier,
    mediumMultiplier: row.mediumMultiplier,
    largeMultiplier: row.largeMultiplier,
    maxLotsPerOrder: row.maxLotsPerOrder,
    marketOrderThreshold: row.marketOrderThreshold,
    maxSlippage: row.maxSlippage,
    marginWarningThreshold: row.marginWarningThreshold,
    marginRejectThreshold: row.marginRejectThreshold,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildMetaApiInterface(connection: any): MetaApiTradeInterface {
  return {
    async createOrder(params) {
      try {
        // MetaApi SDK uses specific methods per order type
        const { symbol, type, volume, openPrice, stopLoss, takeProfit, comment, slippage } = params;
        const opts = { comment, slippage };
        let result;

        switch (type) {
          case 'ORDER_TYPE_BUY':
            result = await connection.createMarketBuyOrder(symbol, volume, stopLoss, takeProfit, opts);
            break;
          case 'ORDER_TYPE_SELL':
            result = await connection.createMarketSellOrder(symbol, volume, stopLoss, takeProfit, opts);
            break;
          case 'ORDER_TYPE_BUY_LIMIT':
            result = await connection.createLimitBuyOrder(symbol, volume, openPrice, stopLoss, takeProfit, opts);
            break;
          case 'ORDER_TYPE_SELL_LIMIT':
            result = await connection.createLimitSellOrder(symbol, volume, openPrice, stopLoss, takeProfit, opts);
            break;
          case 'ORDER_TYPE_BUY_STOP':
            result = await connection.createStopBuyOrder(symbol, volume, openPrice, stopLoss, takeProfit, opts);
            break;
          case 'ORDER_TYPE_SELL_STOP':
            result = await connection.createStopSellOrder(symbol, volume, openPrice, stopLoss, takeProfit, opts);
            break;
          default:
            throw new Error(`Unknown order type: ${type}`);
        }

        return { orderId: result.orderId || result.positionId || 'unknown' };
      } catch (error) {
        console.error(`[metaapi] createOrder failed for ${params.symbol} (${params.type}):`, error);
        throw new Error(`MetaApi createOrder failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    async cancelOrder(orderId) {
      try {
        await connection.cancelOrder(orderId);
      } catch (error) {
        console.error(`[metaapi] cancelOrder failed for ${orderId}:`, error);
        throw new Error(`MetaApi cancelOrder failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    async modifyPosition(positionId, params) {
      try {
        await connection.modifyPosition(positionId, params.stopLoss, params.takeProfit);
      } catch (error) {
        console.error(`[metaapi] modifyPosition failed for ${positionId}:`, error);
        throw new Error(`MetaApi modifyPosition failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    async calculateMargin(params) {
      try {
        const result = await connection.calculateMargin({
          symbol: params.symbol,
          volume: params.volume,
          type: params.type,
          openPrice: params.openPrice,
        });
        return { margin: result.margin };
      } catch (error) {
        console.error(`[metaapi] calculateMargin failed:`, error);
        throw new Error(`MetaApi calculateMargin failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    async getAccountInformation() {
      try {
        return await connection.getAccountInformation();
      } catch (error) {
        console.error(`[metaapi] getAccountInformation failed:`, error);
        throw new Error(`MetaApi getAccountInformation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}

function buildDryRunMetaApi(): MetaApiTradeInterface {
  return {
    async createOrder() { return { orderId: 'dry-run' }; },
    async cancelOrder() {},
    async modifyPosition() {},
    async calculateMargin() { return { margin: 0 }; },
    async getAccountInformation() { return { balance: 0, equity: 0, freeMargin: 0 }; },
  };
}

// ─── Main Loop ────────────────────────────────────────

async function main(): Promise<void> {
  console.log('[worker] Signal listener starting...');

  // Load the latest offset from DB
  await loadLastOffset();

  // Find all configs to determine which source/accounts to connect
  const allConfigs = await db.query.signalConfigs.findMany();

  if (allConfigs.length === 0) {
    console.log('[worker] No signal configs found. Waiting for configuration...');
    while (!isShuttingDown) {
      await sleep(30_000);
      const newConfigs = await db.query.signalConfigs.findMany();
      if (newConfigs.length > 0) {
        console.log('[worker] Config found — restarting...');
        return main();
      }
    }
    return;
  }

  // Get unique sources (typically one Telegram channel)
  const sourceIds = [...new Set(allConfigs.map((c) => c.sourceId))];
  const sources: (typeof signalSources.$inferSelect)[] = [];
  for (const sid of sourceIds) {
    const source = await db.query.signalSources.findFirst({ where: eq(signalSources.id, sid) });
    if (source) sources.push(source);
  }

  // Connect MetaApi streaming for each unique account that has an enabled config
  const enabledConfigs = allConfigs.filter((c) => c.isEnabled);
  const accountIds = [...new Set(enabledConfigs.map((c) => c.accountId))];

  console.log(`[worker] ${allConfigs.length} config(s), ${enabledConfigs.length} enabled, ${accountIds.length} account(s)`);

  for (const accountId of accountIds) {
    const account = await db.query.tradingAccounts.findFirst({
      where: eq(tradingAccounts.id, accountId),
    });
    if (!account) continue;

    const config = enabledConfigs.find((c) => c.accountId === accountId);
    console.log(`[worker] Account: ${account.name} | ${config?.dryRun ? 'DRY RUN' : 'LIVE'}`);

    if (!config?.dryRun) {
      try {
        await startPriceStreaming(account.id, account.metaApiId);
      } catch (error) {
        console.error(`[worker] Failed to start streaming for ${account.name}:`, error);
      }
    }
  }

  // Start Telegram listener for each source (dispatches to all enabled configs)
  for (const source of sources) {
    try {
      await startTelegramListener(source);
    } catch (error) {
      console.error(`[worker] Failed to start Telegram for source ${source.name}:`, error);
    }
  }

  // Periodically reload offset from DB
  const offsetRefreshInterval = setInterval(async () => {
    if (isShuttingDown) return;
    await loadLastOffset();
  }, 60_000);

  console.log('[worker] Signal listener running. Press Ctrl+C to stop.');
  await new Promise<void>((resolve) => {
    const shutdown = async () => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      console.log('\n[worker] Shutting down...');
      clearInterval(offsetRefreshInterval);

      if (telegramClient) {
        await telegramClient.disconnect().catch(() => {});
      }
      for (const [id, { streaming, rpc }] of accountConnections) {
        try { await streaming.close(); } catch {}
        try { await rpc.close(); } catch {}
      }
      accountConnections.clear();

      for (const source of sources) {
        await db
          .update(signalSources)
          .set({ telegramStatus: 'disconnected' })
          .where(eq(signalSources.id, source.id))
          .catch(() => {});
      }

      console.log('[worker] Shutdown complete.');
      resolve();
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error('[worker] Fatal error:', err);
  process.exit(1);
});
