import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { signalConfigs, signalSources, tradingAccounts } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

/**
 * GET /api/signals/config — returns ALL configs for this user (one per account)
 * Query: ?accountId=xyz — optionally filter to a single account's config
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const accountId = request.nextUrl.searchParams.get('accountId');

  if (accountId) {
    const config = await db.query.signalConfigs.findFirst({
      where: and(eq(signalConfigs.userId, session.user.id), eq(signalConfigs.accountId, accountId)),
    });
    return NextResponse.json(config ?? null);
  }

  const configs = await db.query.signalConfigs.findMany({
    where: eq(signalConfigs.userId, session.user.id),
  });

  return NextResponse.json(configs);
}

/**
 * POST /api/signals/config — create or update config (upsert by userId + accountId)
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();

  if (!body.accountId) {
    return NextResponse.json({ error: 'accountId is required' }, { status: 400 });
  }

  // Validate sourceId and accountId belong to this user
  if (body.sourceId) {
    const source = await db.query.signalSources.findFirst({
      where: and(eq(signalSources.id, body.sourceId), eq(signalSources.userId, session.user.id)),
    });
    if (!source) return NextResponse.json({ error: 'Invalid source' }, { status: 400 });
  }

  const account = await db.query.tradingAccounts.findFirst({
    where: and(eq(tradingAccounts.id, body.accountId), eq(tradingAccounts.userId, session.user.id)),
  });
  if (!account) return NextResponse.json({ error: 'Invalid account' }, { status: 400 });

  // Find existing config for this user + account combo
  const existing = await db.query.signalConfigs.findFirst({
    where: and(eq(signalConfigs.userId, session.user.id), eq(signalConfigs.accountId, body.accountId)),
  });

  const configData = {
    userId: session.user.id,
    sourceId: body.sourceId,
    accountId: body.accountId,
    isEnabled: body.isEnabled ?? false,
    dryRun: body.dryRun ?? true,
    nqSymbol: body.nqSymbol ?? 'NAS100',
    esSymbol: body.esSymbol ?? 'US500',
    nqSmallLots: body.nqSmallLots ?? 0.01,
    nqMediumLots: body.nqMediumLots ?? 0.05,
    nqLargeLots: body.nqLargeLots ?? 0.10,
    esSmallLots: body.esSmallLots ?? 0.01,
    esMediumLots: body.esMediumLots ?? 0.05,
    esLargeLots: body.esLargeLots ?? 0.10,
    offsetMode: body.offsetMode ?? 'webhook',
    nqFixedOffset: body.nqFixedOffset ?? 198,
    esFixedOffset: body.esFixedOffset ?? 40,
    nqMaxOffset: body.nqMaxOffset ?? 400,
    nqMinOffset: body.nqMinOffset ?? 50,
    esMaxOffset: body.esMaxOffset ?? 150,
    esMinOffset: body.esMinOffset ?? 10,
    sizingMode: body.sizingMode ?? 'strict',
    executionMode: body.executionMode ?? 'single',
    baseRiskPercent: body.baseRiskPercent ?? 1.0,
    maxRiskPercent: body.maxRiskPercent ?? 5.0,
    nqBaseRiskPercent: body.nqBaseRiskPercent ?? null,
    nqMaxRiskPercent: body.nqMaxRiskPercent ?? null,
    esBaseRiskPercent: body.esBaseRiskPercent ?? null,
    esMaxRiskPercent: body.esMaxRiskPercent ?? null,
    minStopDistance: body.minStopDistance ?? 10,
    maxLotSize: body.maxLotSize ?? 0.10,
    smallMultiplier: body.smallMultiplier ?? 0.5,
    mediumMultiplier: body.mediumMultiplier ?? 1.0,
    largeMultiplier: body.largeMultiplier ?? 1.5,
    maxLotsPerOrder: Math.min(body.maxLotsPerOrder ?? 50, 100),
    marketOrderThreshold: body.marketOrderThreshold ?? 5.0,
    nqMarketOrderThreshold: body.nqMarketOrderThreshold ?? null,
    esMarketOrderThreshold: body.esMarketOrderThreshold ?? null,
    maxSlippage: body.maxSlippage ?? 5.0,
    marginWarningThreshold: body.marginWarningThreshold ?? 80,
    marginRejectThreshold: body.marginRejectThreshold ?? 95,
  };

  if (existing) {
    const [updated] = await db
      .update(signalConfigs)
      .set(configData)
      .where(eq(signalConfigs.id, existing.id))
      .returning();
    return NextResponse.json(updated);
  } else {
    if (!body.sourceId) {
      return NextResponse.json({ error: 'sourceId required for initial setup' }, { status: 400 });
    }
    const [created] = await db.insert(signalConfigs).values(configData).returning();
    return NextResponse.json(created, { status: 201 });
  }
}
