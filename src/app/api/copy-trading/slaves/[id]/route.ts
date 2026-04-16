import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { copySlaves, copyGroups } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

async function verifySlave(slaveId: string, userId: string) {
  const slave = await db.query.copySlaves.findFirst({
    where: eq(copySlaves.id, slaveId),
    with: { group: true },
  });
  if (!slave || slave.group.userId !== userId) return null;
  return slave;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const slave = await verifySlave(id, session.user.id);
  if (!slave) return NextResponse.json({ error: 'Slave not found' }, { status: 404 });

  const body = await request.json();
  const fields: Record<string, unknown> = {};

  const allowed = [
    'isEnabled', 'dryRun', 'sizingMode', 'multiplier', 'riskPercent', 'riskBase',
    'maxRiskPercent', 'fixedLots', 'maxLotSize', 'maxLotsPerOrder', 'maxSlippage',
    'marginWarningPct', 'marginRejectPct', 'directionFilter', 'maxOpenPositions',
  ];
  for (const key of allowed) {
    if (body[key] !== undefined) fields[key] = body[key];
  }

  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const [updated] = await db.update(copySlaves).set(fields).where(eq(copySlaves.id, id)).returning();
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const slave = await verifySlave(id, session.user.id);
  if (!slave) return NextResponse.json({ error: 'Slave not found' }, { status: 404 });

  await db.delete(copySlaves).where(eq(copySlaves.id, id));
  return NextResponse.json({ success: true });
}
