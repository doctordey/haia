import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { copySymbolMaps, copySlaves } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

async function verifyMap(mapId: string, userId: string) {
  const map = await db.query.copySymbolMaps.findFirst({
    where: eq(copySymbolMaps.id, mapId),
    with: { slave: { with: { group: true } } },
  });
  if (!map || map.slave.group.userId !== userId) return null;
  return map;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const map = await verifyMap(id, session.user.id);
  if (!map) return NextResponse.json({ error: 'Symbol map not found' }, { status: 404 });

  const body = await request.json();
  const fields: Record<string, unknown> = {};

  const allowed = [
    'masterSymbol', 'slaveSymbol', 'sizingMode', 'multiplier', 'riskPercent', 'fixedLots',
    'pipValuePerLot', 'minLotSize', 'lotStep', 'copySl', 'copyTp',
    'applyOffset', 'offsetInstrument', 'isEnabled',
  ];
  for (const key of allowed) {
    if (body[key] !== undefined) fields[key] = body[key];
  }

  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const [updated] = await db.update(copySymbolMaps).set(fields).where(eq(copySymbolMaps.id, id)).returning();
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const map = await verifyMap(id, session.user.id);
  if (!map) return NextResponse.json({ error: 'Symbol map not found' }, { status: 404 });

  await db.delete(copySymbolMaps).where(eq(copySymbolMaps.id, id));
  return NextResponse.json({ success: true });
}
