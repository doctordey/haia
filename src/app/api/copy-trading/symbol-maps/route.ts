import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { copySymbolMaps, copySlaves, copyGroups } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { slaveId, masterSymbol, slaveSymbol } = body;

  if (!slaveId || !masterSymbol || !slaveSymbol) {
    return NextResponse.json({ error: 'slaveId, masterSymbol, and slaveSymbol are required' }, { status: 400 });
  }

  const slave = await db.query.copySlaves.findFirst({
    where: eq(copySlaves.id, slaveId),
    with: { group: true },
  });
  if (!slave || slave.group.userId !== session.user.id) {
    return NextResponse.json({ error: 'Slave not found' }, { status: 404 });
  }

  const [symbolMap] = await db.insert(copySymbolMaps).values({
    slaveId,
    masterSymbol: masterSymbol.toUpperCase(),
    slaveSymbol: slaveSymbol.toUpperCase(),
    sizingMode: body.sizingMode || null,
    multiplier: body.multiplier ?? null,
    riskPercent: body.riskPercent ?? null,
    fixedLots: body.fixedLots ?? null,
    pipValuePerLot: body.pipValuePerLot ?? 1.0,
    minLotSize: body.minLotSize ?? 0.01,
    lotStep: body.lotStep ?? 0.01,
    copySl: body.copySl ?? true,
    copyTp: body.copyTp ?? true,
    applyOffset: body.applyOffset ?? false,
    offsetInstrument: body.offsetInstrument || null,
  }).returning();

  return NextResponse.json(symbolMap, { status: 201 });
}
