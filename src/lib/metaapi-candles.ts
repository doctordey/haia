// Fetch recent candle history from MetaApi for swing detection. Opens a
// short-lived RPC connection, requests N candles ending at `now`, closes.

import type { Candle } from '@/lib/signals/swing-detection';

const TIMEFRAME_MAP: Record<string, string> = {
  '1m':  '1m',
  '5m':  '5m',
  '15m': '15m',
  '30m': '30m',
  '1h':  '1h',
  '4h':  '4h',
};

/**
 * Returns the most recent `limit` candles for `symbol` at `timeframe`.
 * MetaApi's RPC returns candles oldest-first; we sort by time ascending
 * to match the swing-detection contract (most-recent index is last).
 */
export async function fetchRecentCandles(
  metaApiId: string,
  symbol: string,
  timeframe: string,
  limit: number,
): Promise<Candle[]> {
  if (!process.env.METAAPI_TOKEN) {
    throw new Error('METAAPI_TOKEN environment variable is not set');
  }
  const tf = TIMEFRAME_MAP[timeframe] ?? timeframe;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const MetaApi = require('metaapi.cloud-sdk').default;
  const api = new MetaApi(process.env.METAAPI_TOKEN);
  const account = await api.metatraderAccountApi.getAccount(metaApiId);
  if (account.state !== 'DEPLOYED') {
    await account.waitDeployed();
  }
  const connection = account.getRPCConnection();
  await connection.connect();
  await connection.waitSynchronized();

  try {
    // getHistoricalCandles(symbol, timeframe, startTime, limit) — startTime
    // omitted = "ending now".
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any[] = await connection.getHistoricalCandles(symbol, tf, undefined, limit);
    const candles: Candle[] = (raw ?? []).map((c) => ({
      time: c.time instanceof Date ? c.time.getTime() : Date.parse(c.time),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
    })).filter((c) => Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low));

    candles.sort((a, b) => a.time - b.time);
    return candles;
  } finally {
    try { await connection.close(); } catch { /* best effort */ }
  }
}
