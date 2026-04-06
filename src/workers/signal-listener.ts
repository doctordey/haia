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
let streamingConnection: any = null;
let isShuttingDown = false;

// ─── MetaApi Price Streaming ──────────────────────────

async function startPriceStreaming(metaApiId: string): Promise<void> {
  console.log('[worker] Starting MetaApi price streaming for NAS100 + US500...');

  const MetaApi = require('metaapi.cloud-sdk').default;
  const api = new MetaApi(process.env.METAAPI_TOKEN);
  const account = await api.metatraderAccountApi.getAccount(metaApiId);

  if (account.state !== 'DEPLOYED') {
    await account.waitDeployed();
  }

  streamingConnection = account.getStreamingConnection();

  // Set up price listener
  streamingConnection.addSynchronizationListener({
    onSymbolPriceUpdated(_instanceIndex: string, price: { symbol: string; bid: number; ask: number }) {
      if (price.symbol === 'NAS100' || price.symbol === 'US500') {
        priceCache.setPrice(price.symbol, price.bid, price.ask);
      }
    },
    // Required listener methods (no-op)
    onConnected() { console.log('[metaapi] Streaming connected'); },
    onDisconnected() { console.log('[metaapi] Streaming disconnected — will auto-reconnect'); },
    onBrokerConnectionStatusChanged(_i: string, connected: boolean) {
      console.log(`[metaapi] Broker connection: ${connected ? 'connected' : 'disconnected'}`);
    },
    // Position closed listener — for breakeven monitoring
    onDealAdded(_instanceIndex: string, deal: { positionId?: string; type?: string; entryType?: string; profit?: number }) {
      if (deal.entryType === 'DEAL_ENTRY_OUT' && deal.positionId) {
        const wasTPHit = (deal.profit ?? 0) > 0;
        handlePositionClosed(deal.positionId, wasTPHit);
      }
    },
  });

  await streamingConnection.connect();
  await streamingConnection.waitSynchronized();

  // Subscribe to NAS100 and US500 price streams
  await streamingConnection.subscribeToMarketData('NAS100');
  await streamingConnection.subscribeToMarketData('US500');

  console.log('[worker] Price streaming active for NAS100 + US500');
}

async function handlePositionClosed(positionId: string, wasTPHit: boolean): Promise<void> {
  if (!streamingConnection) return;

  try {
    const metaApi = buildMetaApiInterface(streamingConnection);
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
  config: typeof signalConfigs.$inferSelect,
  account: typeof tradingAccounts.$inferSelect,
): Promise<void> {
  if (!source.telegramSession || !source.telegramChannelId) {
    console.warn('[telegram] Source missing session or channel ID — skipping');
    return;
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

  telegramClient.listenToChannel(source.telegramChannelId, async (text, messageId) => {
    await handleTelegramMessage(text, messageId, source, config, account);
  });

  await db
    .update(signalSources)
    .set({ telegramStatus: 'connected' })
    .where(eq(signalSources.id, source.id));
}

// ─── Message Handler ──────────────────────────────────

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

  switch (parsed.type) {
    case 'signals': {
      console.log(`[signal] Parsed ${parsed.signals.length} signals${parsed.warning ? ` (warning: ${parsed.warning})` : ''}`);

      const signalConfig = buildSignalConfig(config);
      const accountInfo = {
        balance: account.leverage ? 10000 : 10000, // Will be fetched from MetaApi
        equity: 10000,
      };

      // Get live account info from MetaApi
      if (streamingConnection) {
        try {
          const info = await streamingConnection.getAccountInformation();
          accountInfo.balance = info.balance;
          accountInfo.equity = info.equity;
        } catch (err) {
          console.warn('[signal] Could not fetch live account info, using cached');
        }
      }

      const metaApi = streamingConnection ? buildMetaApiInterface(streamingConnection) : buildDryRunMetaApi();

      const results = await executePipeline(
        text,
        signalRow.id,
        signalConfig,
        priceCache,
        accountInfo,
        metaApi,
      );

      // Persist execution results
      for (const result of results) {
        await db.insert(signalExecutions).values({
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
        });
      }

      const latency = Date.now() - startTime;
      const statuses = results.map((r) => r.status).join(', ');
      console.log(`[signal] Executed ${results.length} orders [${statuses}] in ${latency}ms`);
      break;
    }

    case 'cancellation': {
      console.log(`[signal] Cancellation: ${parsed.cancellation.type}`);
      if (streamingConnection) {
        const metaApi = buildMetaApiInterface(streamingConnection);
        const results = await handleCancellation(parsed, config.id, metaApi);
        console.log(`[signal] Cancellation results: ${results.map((r) => `${r.executionId}=${r.status}`).join(', ')}`);
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
      const result = await connection.createOrder({
        symbol: params.symbol,
        type: params.type,
        volume: params.volume,
        openPrice: params.openPrice,
        stopLoss: params.stopLoss,
        takeProfit: params.takeProfit,
        comment: params.comment,
        slippage: params.slippage,
      });
      return { orderId: result.orderId };
    },
    async cancelOrder(orderId) {
      await connection.cancelOrder(orderId);
    },
    async modifyPosition(positionId, params) {
      await connection.modifyPosition(positionId, params);
    },
    async calculateMargin(params) {
      const result = await connection.calculateMargin({
        symbol: params.symbol,
        volume: params.volume,
        type: params.type,
      });
      return { margin: result.margin };
    },
    async getAccountInformation() {
      return connection.getAccountInformation();
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

  // Load the latest offset from DB (TradingView webhook fires to the API server)
  await loadLastOffset();

  // Find active signal config
  const configs = await db.query.signalConfigs.findMany({
    with: { source: true, account: true },
  });

  if (configs.length === 0) {
    console.log('[worker] No signal configs found. Waiting for configuration...');
    // Poll for config every 30s
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

  const config = configs[0];
  const source = await db.query.signalSources.findFirst({
    where: eq(signalSources.id, config.sourceId),
  });
  const account = await db.query.tradingAccounts.findFirst({
    where: eq(tradingAccounts.id, config.accountId),
  });

  if (!source || !account) {
    console.error('[worker] Source or account not found for config', config.id);
    return;
  }

  console.log(`[worker] Config: ${config.id} | Source: ${source.name} | Account: ${account.name}`);
  console.log(`[worker] Mode: ${config.dryRun ? 'DRY RUN' : 'LIVE'} | Enabled: ${config.isEnabled}`);

  // Start MetaApi price streaming
  try {
    await startPriceStreaming(account.metaApiId);
  } catch (error) {
    console.error('[worker] Failed to start price streaming:', error);
    console.log('[worker] Continuing without live prices (will use stale/fixed data)');
  }

  // Start Telegram listener
  try {
    await startTelegramListener(source, config, account);
  } catch (error) {
    console.error('[worker] Failed to start Telegram listener:', error);
  }

  // Periodically reload offset from DB (in case webhook hit the API server)
  const offsetRefreshInterval = setInterval(async () => {
    if (isShuttingDown) return;
    await loadLastOffset();
  }, 60_000); // Every 60s

  // Keep alive
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
      if (streamingConnection) {
        await streamingConnection.close().catch(() => {});
      }

      // Mark source as disconnected
      if (source) {
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
