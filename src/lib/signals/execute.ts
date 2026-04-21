import { createId } from '@paralleldrive/cuid2';
import { parseSignalMessage } from './parser';
import { getOffset, adjustSignalLevels } from './offset';
import { determineOrderType } from './order-type';
import { calculateLotSize, chunkLots } from './sizing';
import { checkMargin, evaluateMargin } from './margin';
import type {
  SignalConfig,
  PriceCache,
  AccountInfo,
  ContractSpec,
  MetaApiTradeInterface,
  ExecutionResult,
  ParsedSignal,
  SizingConfig,
  INSTRUMENT_MAP,
  ExecutionStatus,
} from '@/types/signals';
import { INSTRUMENT_MAP as InstrumentMap, DEFAULT_CONTRACT_SPECS } from '@/types/signals';

interface PipelineContext {
  signalId: string;
  config: SignalConfig;
  priceCache: PriceCache;
  account: AccountInfo;
  metaApi: MetaApiTradeInterface;
  contractSpecs?: Record<string, ContractSpec>;
}

function buildSizingConfig(config: SignalConfig, instrument: 'NQ' | 'ES'): SizingConfig {
  const prefix = instrument.toLowerCase() as 'nq' | 'es';
  return {
    mode: config.sizingMode,
    executionMode: config.executionMode,
    strictLots: {
      Small: config[`${prefix}SmallLots`],
      Medium: config[`${prefix}MediumLots`],
      Large: config[`${prefix}LargeLots`],
    },
    baseRiskPercent: (prefix === 'nq' ? config.nqBaseRiskPercent : config.esBaseRiskPercent) ?? config.baseRiskPercent,
    sizeMultipliers: {
      Small: config.smallMultiplier,
      Medium: config.mediumMultiplier,
      Large: config.largeMultiplier,
    },
    maxRiskPercent: (prefix === 'nq' ? config.nqMaxRiskPercent : config.esMaxRiskPercent) ?? config.maxRiskPercent,
    minStopDistance: config.minStopDistance,
    maxLotSize: config.maxLotSize,
    maxLotsPerOrder: config.maxLotsPerOrder,
  };
}

function mapOrderType(
  direction: 'LONG' | 'SHORT',
  orderType: string,
): string {
  if (orderType === 'MARKET') {
    return direction === 'LONG' ? 'ORDER_TYPE_BUY' : 'ORDER_TYPE_SELL';
  }
  return `ORDER_TYPE_${orderType}`;
}

async function executeSignal(
  signal: ParsedSignal,
  ctx: PipelineContext,
): Promise<ExecutionResult[]> {
  const startTime = Date.now();
  const { config, priceCache, account, metaApi, signalId } = ctx;
  const specs = ctx.contractSpecs ?? DEFAULT_CONTRACT_SPECS;
  const fusionSymbol = InstrumentMap[signal.instrument].fusionSymbol;
  const contractSpec = specs[fusionSymbol] ?? DEFAULT_CONTRACT_SPECS[fusionSymbol];

  const baseResult: Omit<ExecutionResult, 'lotSize' | 'splitIndex' | 'linkedExecutionId' | 'chunkIndex' | 'totalChunks' | 'status' | 'metaapiOrderId' | 'fillPrice' | 'slippage' | 'errorMessage' | 'orderSentAt' | 'orderFilledAt' | 'totalLatencyMs' | 'orderType' | 'orderReason' | 'isDryRun'> = {
    signalId,
    configId: config.id,
    accountId: config.id, // Will be overridden by caller
    tradeNumber: signal.tradeNumber,
    instrument: signal.instrument,
    fusionSymbol,
    direction: signal.direction,
    signalEntry: signal.entryPrice,
    signalSl: signal.stopLoss,
    signalTp1: signal.tp1,
    signalTp2: signal.tp2,
    signalSize: signal.size,
    futuresPriceAtExec: null,
    fusionPriceAtExec: null,
    offsetApplied: null,
    offsetIsStale: false,
    adjustedEntry: null,
    adjustedSl: null,
    adjustedTp1: null,
    adjustedTp2: null,
    signalReceivedAt: new Date(startTime),
  };

  // 1. Calculate offset
  let offsetResult;
  try {
    offsetResult = getOffset(signal.instrument, priceCache, config);
  } catch (error) {
    return [makeErrorResult(baseResult, config, `Offset error: ${error instanceof Error ? error.message : String(error)}`)];
  }

  // 2. Adjust levels
  const adjusted = adjustSignalLevels(signal, offsetResult.offset);

  // 3. Get current Fusion price for order type decision
  const currentPrice = priceCache.getFusionPrice(fusionSymbol);
  if (currentPrice == null && !config.dryRun) {
    return [makeErrorResult(baseResult, config, `No current price for ${fusionSymbol} — MetaApi price stream may be stale (>10s) or disconnected. Execution blocked.`)];
  }

  // 4. Determine order type (per-instrument threshold)
  const instrumentThreshold = signal.instrument === 'NQ'
    ? (config.nqMarketOrderThreshold ?? config.marketOrderThreshold)
    : (config.esMarketOrderThreshold ?? config.marketOrderThreshold);
  const orderDecision = currentPrice != null
    ? determineOrderType(signal.direction, adjusted.entry, currentPrice, instrumentThreshold)
    : { orderType: 'MARKET' as const, reason: 'No live price — defaulting to MARKET (dry run)' };

  // 5. Calculate lot size
  const sizingConfig = buildSizingConfig(config, signal.instrument);
  const sizing = calculateLotSize(
    sizingConfig,
    { size: signal.size, entryPrice: adjusted.entry, stopLoss: adjusted.sl },
    account,
    contractSpec,
  );

  // Debug: log the full sizing decision
  const stopDist = Math.abs(adjusted.entry - adjusted.sl);
  console.log(
    `[sizing] ${signal.instrument} ${signal.direction} | mode=${sizingConfig.mode} ` +
    `balance=$${account.balance.toFixed(0)} equity=$${account.equity.toFixed(0)} | ` +
    `baseRisk=${sizingConfig.baseRiskPercent}% maxRisk=${sizingConfig.maxRiskPercent}% ` +
    `size=${signal.size} mult=${sizingConfig.sizeMultipliers[signal.size]} | ` +
    `entry=${adjusted.entry} sl=${adjusted.sl} stopDist=${stopDist.toFixed(1)}pts ` +
    `pipValue=${contractSpec.pipValuePerLot} | ` +
    `result: ${sizing.lotSize} lots (${sizing.chunks.length} chunks) — ${sizing.reason}`
  );

  // Shared fields for all executions from this signal
  const sharedFields = {
    ...baseResult,
    futuresPriceAtExec: offsetResult.futuresPrice || null,
    fusionPriceAtExec: currentPrice ?? null,
    offsetApplied: offsetResult.offset,
    offsetIsStale: offsetResult.isStale,
    adjustedEntry: adjusted.entry,
    adjustedSl: adjusted.sl,
    adjustedTp1: adjusted.tp1,
    adjustedTp2: adjusted.tp2,
    orderType: orderDecision.orderType,
    orderReason: orderDecision.reason,
  };

  // 6. Check margin for total position
  if (!config.dryRun) {
    try {
      const marginResult = await checkMargin(metaApi, fusionSymbol, sizing.lotSize, signal.direction, adjusted.entry);
      const marginEval = evaluateMargin(marginResult, config.marginWarningThreshold, config.marginRejectThreshold);

      if (marginEval.action === 'reject') {
        return [makeErrorResult(
          { ...sharedFields },
          config,
          marginEval.message,
          'rejected',
          marginResult.marginUtilization,
        )];
      }

      if (marginEval.action === 'warn') {
        console.warn(`[${signal.instrument}] ${marginEval.message}`);
      }
    } catch (error) {
      return [makeErrorResult(
        { ...sharedFields },
        config,
        `Margin check failed: ${error instanceof Error ? error.message : String(error)}`,
      )];
    }
  }

  // 7. Build and execute orders
  if (config.dryRun) {
    return buildDryRunResults(sharedFields, sizing, config);
  }

  return await sendOrders(sharedFields, sizing, config, metaApi, adjusted, orderDecision, startTime);
}

function makeErrorResult(
  base: Record<string, unknown>,
  config: SignalConfig,
  errorMessage: string,
  status: ExecutionStatus = 'error',
  marginUtilization?: number,
): ExecutionResult {
  return {
    ...base,
    lotSize: 0,
    splitIndex: null,
    linkedExecutionId: null,
    chunkIndex: null,
    totalChunks: null,
    status,
    metaapiOrderId: null,
    fillPrice: null,
    slippage: null,
    errorMessage,
    orderSentAt: null,
    orderFilledAt: null,
    totalLatencyMs: null,
    orderType: (base.orderType as ExecutionResult['orderType']) ?? null,
    orderReason: (base.orderReason as string) ?? null,
    isDryRun: config.dryRun,
    marginUtilization,
  } as ExecutionResult;
}

function buildDryRunResults(
  shared: Record<string, unknown>,
  sizing: ReturnType<typeof calculateLotSize>,
  config: SignalConfig,
): ExecutionResult[] {
  const results: ExecutionResult[] = [];

  if (sizing.isSplit && sizing.tp1Chunks && sizing.tp2Chunks) {
    const tp1Id = createId();
    const tp2Id = createId();

    for (let i = 0; i < sizing.tp1Chunks.length; i++) {
      results.push({
        ...shared,
        lotSize: sizing.tp1Chunks[i],
        splitIndex: 1,
        linkedExecutionId: tp2Id,
        chunkIndex: sizing.tp1Chunks.length > 1 ? i + 1 : null,
        totalChunks: sizing.tp1Chunks.length > 1 ? sizing.tp1Chunks.length : null,
        status: 'dry_run',
        metaapiOrderId: null,
        fillPrice: null,
        slippage: null,
        errorMessage: null,
        orderSentAt: null,
        orderFilledAt: null,
        totalLatencyMs: null,
        isDryRun: true,
      } as ExecutionResult);
    }

    for (let i = 0; i < sizing.tp2Chunks.length; i++) {
      results.push({
        ...shared,
        lotSize: sizing.tp2Chunks[i],
        splitIndex: 2,
        linkedExecutionId: tp1Id,
        chunkIndex: sizing.tp2Chunks.length > 1 ? i + 1 : null,
        totalChunks: sizing.tp2Chunks.length > 1 ? sizing.tp2Chunks.length : null,
        status: 'dry_run',
        metaapiOrderId: null,
        fillPrice: null,
        slippage: null,
        errorMessage: null,
        orderSentAt: null,
        orderFilledAt: null,
        totalLatencyMs: null,
        isDryRun: true,
      } as ExecutionResult);
    }
  } else {
    for (let i = 0; i < sizing.chunks.length; i++) {
      results.push({
        ...shared,
        lotSize: sizing.chunks[i],
        splitIndex: null,
        linkedExecutionId: null,
        chunkIndex: sizing.chunks.length > 1 ? i + 1 : null,
        totalChunks: sizing.chunks.length > 1 ? sizing.chunks.length : null,
        status: 'dry_run',
        metaapiOrderId: null,
        fillPrice: null,
        slippage: null,
        errorMessage: null,
        orderSentAt: null,
        orderFilledAt: null,
        totalLatencyMs: null,
        isDryRun: true,
      } as ExecutionResult);
    }
  }

  return results;
}

async function sendOrders(
  shared: Record<string, unknown>,
  sizing: ReturnType<typeof calculateLotSize>,
  config: SignalConfig,
  metaApi: MetaApiTradeInterface,
  adjusted: { entry: number; sl: number; tp1: number; tp2: number },
  orderDecision: { orderType: string; reason: string },
  startTime: number,
): Promise<ExecutionResult[]> {
  const direction = shared.direction as 'LONG' | 'SHORT';
  const fusionSymbol = shared.fusionSymbol as string;
  const metaOrderType = mapOrderType(direction, orderDecision.orderType);

  async function sendChunk(
    lotSize: number,
    tp: number,
    splitIndex: number | null,
    linkedId: string | null,
    chunkIdx: number | null,
    totalChunks: number | null,
  ): Promise<ExecutionResult> {
    const sentAt = new Date();
    const maxRetries = 3;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await metaApi.createOrder({
          symbol: fusionSymbol,
          type: metaOrderType,
          volume: lotSize,
          openPrice: orderDecision.orderType !== 'MARKET' ? adjusted.entry : undefined,
          stopLoss: adjusted.sl,
          takeProfit: tp,
          comment: `haia-${shared.tradeNumber}`,
          slippage: config.maxSlippage,
        });

        return {
          ...shared,
          lotSize,
          splitIndex,
          linkedExecutionId: linkedId,
          chunkIndex: chunkIdx,
          totalChunks,
          status: 'sent',
          metaapiOrderId: result.orderId,
          fillPrice: null,
          slippage: null,
          errorMessage: null,
          orderSentAt: sentAt,
          orderFilledAt: null,
          totalLatencyMs: Date.now() - startTime,
          isDryRun: false,
        } as ExecutionResult;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        const errObj = error as { status?: number; metadata?: { recommendedRetryTime?: string } };

        // MetaAPI rate limit (429) — wait and retry
        if (errObj.status === 429 && attempt < maxRetries) {
          const retryTime = errObj.metadata?.recommendedRetryTime
            ? new Date(errObj.metadata.recommendedRetryTime).getTime() - Date.now()
            : (attempt + 1) * 1000;
          const waitMs = Math.min(Math.max(retryTime, 500), 10000);
          console.warn(`[execute] Rate limit hit, waiting ${waitMs}ms before retry (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }

        return {
          ...shared,
          lotSize,
          splitIndex,
          linkedExecutionId: linkedId,
          chunkIndex: chunkIdx,
          totalChunks,
          status: 'error',
          metaapiOrderId: null,
          fillPrice: null,
          slippage: null,
          errorMessage: errMsg,
          orderSentAt: sentAt,
          orderFilledAt: null,
          totalLatencyMs: Date.now() - startTime,
          isDryRun: false,
        } as ExecutionResult;
      }
    }
    // Unreachable — all paths above return
    throw new Error('unreachable');
  }

  // Throttle chunk sending to avoid MetaAPI rate limits
  // 2000 CPU credits/sec ÷ 10 per order = 200 orders/sec theoretical max.
  // We use 50 orders per batch with 100ms delay = 500/sec peak, still safe.
  async function sendChunksThrottled(
    chunks: Array<() => Promise<ExecutionResult>>,
  ): Promise<ExecutionResult[]> {
    const BATCH_SIZE = 25;
    const BATCH_DELAY_MS = 200;
    const results: ExecutionResult[] = [];
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(batch.map((fn) => fn()));
      results.push(...batchResults);
      if (i + BATCH_SIZE < chunks.length) {
        await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
      }
    }
    return results;
  }

  const chunkFactories: Array<() => Promise<ExecutionResult>> = [];

  if (sizing.isSplit && sizing.tp1Chunks && sizing.tp2Chunks) {
    const tp1Id = createId();
    const tp2Id = createId();

    for (let i = 0; i < sizing.tp1Chunks.length; i++) {
      const idx = i;
      chunkFactories.push(() => sendChunk(
        sizing.tp1Chunks![idx], adjusted.tp1, 1, tp2Id,
        sizing.tp1Chunks!.length > 1 ? idx + 1 : null,
        sizing.tp1Chunks!.length > 1 ? sizing.tp1Chunks!.length : null,
      ));
    }
    for (let i = 0; i < sizing.tp2Chunks.length; i++) {
      const idx = i;
      chunkFactories.push(() => sendChunk(
        sizing.tp2Chunks![idx], adjusted.tp2, 2, tp1Id,
        sizing.tp2Chunks!.length > 1 ? idx + 1 : null,
        sizing.tp2Chunks!.length > 1 ? sizing.tp2Chunks!.length : null,
      ));
    }
  } else {
    for (let i = 0; i < sizing.chunks.length; i++) {
      const idx = i;
      chunkFactories.push(() => sendChunk(
        sizing.chunks[idx], adjusted.tp1, null, null,
        sizing.chunks.length > 1 ? idx + 1 : null,
        sizing.chunks.length > 1 ? sizing.chunks.length : null,
      ));
    }
  }

  const results = await sendChunksThrottled(chunkFactories);

  // Log summary of chunk execution for debugging partial fills
  const successCount = results.filter((r) => r.status === 'sent').length;
  const errorCount = results.filter((r) => r.status === 'error').length;
  const totalRequestedLots = results.reduce((sum, r) => sum + r.lotSize, 0);
  const totalFilledLots = results
    .filter((r) => r.status === 'sent')
    .reduce((sum, r) => sum + r.lotSize, 0);

  if (errorCount > 0 || results.length > 1) {
    console.log(
      `[execute] ${fusionSymbol} ${direction}: ${successCount}/${results.length} chunks succeeded ` +
      `(${totalFilledLots.toFixed(2)}/${totalRequestedLots.toFixed(2)} lots filled)` +
      (errorCount > 0 ? ` — ${errorCount} errors: ${[...new Set(results.filter((r) => r.status === 'error').map((r) => r.errorMessage))].join(' | ')}` : '')
    );
  }

  return results;
}

// ─── PUBLIC API ──────────────────────────────────────

export async function executePipeline(
  rawMessage: string,
  signalId: string,
  config: SignalConfig,
  priceCache: PriceCache,
  account: AccountInfo,
  metaApi: MetaApiTradeInterface,
  contractSpecs?: Record<string, ContractSpec>,
): Promise<ExecutionResult[]> {
  const parsed = parseSignalMessage(rawMessage);

  if (parsed.type !== 'signals') {
    return [];
  }

  const ctx: PipelineContext = {
    signalId,
    config,
    priceCache,
    account,
    metaApi,
    contractSpecs,
  };

  // Execute all signals from the message in parallel
  const resultArrays = await Promise.all(
    parsed.signals.map((signal) => executeSignal(signal, ctx)),
  );

  return resultArrays.flat();
}
