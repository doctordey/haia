import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { tvAlertConfigs, tradingAccounts } from '@/lib/db/schema';

/**
 * GET  /api/signals/tradingview/configs            — all configs for this user
 * POST /api/signals/tradingview/configs            — upsert by (userId, accountId, tvSymbol)
 */

const FUSION_DEFAULTS: Record<string, string> = {
  XBRUSD: 'XBRUSD',
  UK10YBG: 'UKGILT',
};

const RR_DEFAULTS: Record<string, number> = {
  XBRUSD: 2.0,
  UK10YBG: 1.0,
};

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const configs = await db.query.tvAlertConfigs.findMany({
    where: eq(tvAlertConfigs.userId, session.user.id),
  });

  return NextResponse.json(configs);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = await request.json();

  if (!body.accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 });
  if (!body.tvSymbol)  return NextResponse.json({ error: 'tvSymbol is required'  }, { status: 400 });

  const account = await db.query.tradingAccounts.findFirst({
    where: and(eq(tradingAccounts.id, body.accountId), eq(tradingAccounts.userId, session.user.id)),
  });
  if (!account) return NextResponse.json({ error: 'Invalid account' }, { status: 400 });

  const tvSymbol = String(body.tvSymbol).toUpperCase();
  const fusionSymbol = body.fusionSymbol
    ? String(body.fusionSymbol).toUpperCase()
    : FUSION_DEFAULTS[tvSymbol] ?? tvSymbol;
  const rewardRiskRatio = body.rewardRiskRatio ?? RR_DEFAULTS[tvSymbol] ?? 2.0;

  const data = {
    userId: session.user.id,
    accountId: body.accountId,
    tvSymbol,
    fusionSymbol,
    isEnabled: body.isEnabled ?? false,
    dryRun: body.dryRun ?? true,
    riskPercent: body.riskPercent ?? 5.0,
    rewardRiskRatio,
    slPipOffset: body.slPipOffset ?? 2.0,
    pipSize: body.pipSize ?? 0.01,
    pipValuePerLot: body.pipValuePerLot ?? 0.10,
    sizingMode: body.sizingMode ?? 'percent_equity',
    strictLots: body.strictLots ?? 0.01,
    minLotSize: body.minLotSize ?? 0.01,
    lotStep: body.lotStep ?? 0.01,
    maxLotSize: body.maxLotSize ?? 100,
    maxLotsPerOrder: Math.min(body.maxLotsPerOrder ?? 50, 100),
    minStopDistancePips: body.minStopDistancePips ?? 5,
    maxRiskPercent: body.maxRiskPercent ?? 10.0,
    maxSlippage: body.maxSlippage ?? 5.0,
    marginWarningThreshold: body.marginWarningThreshold ?? 80,
    marginRejectThreshold: body.marginRejectThreshold ?? 95,
    maxOffsetAbs: body.maxOffsetAbs ?? 10,
  };

  const existing = await db.query.tvAlertConfigs.findFirst({
    where: and(
      eq(tvAlertConfigs.userId, session.user.id),
      eq(tvAlertConfigs.accountId, body.accountId),
      eq(tvAlertConfigs.tvSymbol, tvSymbol),
    ),
  });

  if (existing) {
    const [updated] = await db
      .update(tvAlertConfigs)
      .set(data)
      .where(eq(tvAlertConfigs.id, existing.id))
      .returning();
    return NextResponse.json(updated);
  }

  const [created] = await db.insert(tvAlertConfigs).values(data).returning();
  return NextResponse.json(created, { status: 201 });
}
