import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { copySlaves, copyGroups, tradingAccounts } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { groupId, accountId } = body;

  if (!groupId || !accountId) {
    return NextResponse.json({ error: 'groupId and accountId are required' }, { status: 400 });
  }

  const group = await db.query.copyGroups.findFirst({
    where: and(eq(copyGroups.id, groupId), eq(copyGroups.userId, session.user.id)),
  });
  if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });

  const account = await db.query.tradingAccounts.findFirst({
    where: and(eq(tradingAccounts.id, accountId), eq(tradingAccounts.userId, session.user.id)),
  });
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  const [slave] = await db.insert(copySlaves).values({
    groupId,
    accountId,
    sizingMode: body.sizingMode || 'fixed_multiplier',
    multiplier: body.multiplier ?? 1.0,
    riskPercent: body.riskPercent ?? 1.0,
    riskBase: body.riskBase || 'balance',
    maxRiskPercent: body.maxRiskPercent ?? 5.0,
    fixedLots: body.fixedLots ?? 0.01,
    maxLotSize: body.maxLotSize ?? 10.0,
    maxLotsPerOrder: body.maxLotsPerOrder ?? 50,
    maxSlippage: body.maxSlippage ?? 5.0,
    marginWarningPct: body.marginWarningPct ?? 80,
    marginRejectPct: body.marginRejectPct ?? 95,
    directionFilter: body.directionFilter || null,
    maxOpenPositions: body.maxOpenPositions || null,
    dryRun: body.dryRun ?? true,
  }).returning();

  return NextResponse.json(slave, { status: 201 });
}
