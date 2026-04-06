import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { offsetHistory } from '@/lib/db/schema';
import { desc } from 'drizzle-orm';

/**
 * POST /api/signals/offset/webhook
 *
 * Receives offset data from TradingView Pine Script indicator.
 * Authenticated via a shared secret (NOT NextAuth — TradingView can't do session auth).
 *
 * Expected JSON body:
 * {
 *   secret: string,
 *   nq_price: number,    // NQM2026 futures price
 *   es_price: number,    // ESM2026 futures price
 *   nas100_price: number, // Fusion NAS100 CFD price
 *   us500_price: number,  // Fusion US500 CFD price
 *   nq_offset: number,   // nq_price - nas100_price
 *   es_offset: number,   // es_price - us500_price
 *   nq_sma: number,      // SMA of NQ offset
 *   es_sma: number,      // SMA of ES offset
 *   timestamp: string    // TradingView bar timestamp
 * }
 */
export async function POST(request: NextRequest) {
  const webhookSecret = process.env.TRADINGVIEW_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[offset-webhook] TRADINGVIEW_WEBHOOK_SECRET not configured');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Validate secret
  if (body.secret !== webhookSecret) {
    return NextResponse.json({ error: 'Invalid secret' }, { status: 401 });
  }

  const nqOffset = Number(body.nq_offset);
  const esOffset = Number(body.es_offset);
  const nqFuturesPrice = Number(body.nq_price);
  const esFuturesPrice = Number(body.es_price);
  const nas100Price = Number(body.nas100_price);
  const us500Price = Number(body.us500_price);

  if (isNaN(nqOffset) || isNaN(esOffset) || isNaN(nqFuturesPrice) || isNaN(esFuturesPrice)) {
    return NextResponse.json({ error: 'Missing or invalid price data' }, { status: 400 });
  }

  // Contract roll detection — check previous offset
  const [previous] = await db
    .select()
    .from(offsetHistory)
    .orderBy(desc(offsetHistory.receivedAt))
    .limit(1);

  let contractRollWarning: string | null = null;
  if (previous) {
    const nqJump = Math.abs(nqOffset - previous.nqOffset);
    const esJump = Math.abs(esOffset - previous.esOffset);
    if (nqJump > 100) {
      contractRollWarning = `NQ offset jumped ${nqJump.toFixed(1)}pts (${previous.nqOffset.toFixed(1)} → ${nqOffset.toFixed(1)}). Possible contract roll.`;
    }
    if (esJump > 30) {
      contractRollWarning = `ES offset jumped ${esJump.toFixed(1)}pts (${previous.esOffset.toFixed(1)} → ${esOffset.toFixed(1)}). Possible contract roll.`;
    }
  }

  if (contractRollWarning) {
    console.warn(`[offset-webhook] CONTRACT ROLL: ${contractRollWarning}`);
  }

  // Persist to offsetHistory
  await db.insert(offsetHistory).values({
    nqOffset,
    esOffset,
    nqFuturesPrice,
    esFuturesPrice,
    nas100Price,
    us500Price,
    nqOffsetSma: body.nq_sma != null ? Number(body.nq_sma) : null,
    esOffsetSma: body.es_sma != null ? Number(body.es_sma) : null,
    tradingviewTimestamp: body.timestamp ? String(body.timestamp) : null,
  });

  // Update the in-memory price cache if the worker has exported it
  // This uses a global reference that the worker sets on startup
  const globalCache = (globalThis as Record<string, unknown>).__haiaPriceCache as {
    setOffset?: (data: Record<string, unknown>) => void;
  } | undefined;

  if (globalCache?.setOffset) {
    globalCache.setOffset({
      nqOffset,
      esOffset,
      nqFuturesPrice,
      esFuturesPrice,
      nas100Price,
      us500Price,
      nqOffsetSma: body.nq_sma != null ? Number(body.nq_sma) : null,
      esOffsetSma: body.es_sma != null ? Number(body.es_sma) : null,
      receivedAt: Date.now(),
      tradingviewTimestamp: body.timestamp ? String(body.timestamp) : '',
    });
  }

  console.log(
    `[offset-webhook] Received: NQ=${nqOffset.toFixed(2)} ES=${esOffset.toFixed(2)} ` +
    `(NQ futures=${nqFuturesPrice}, ES futures=${esFuturesPrice})`,
  );

  return NextResponse.json({ success: true, contractRollWarning });
}
