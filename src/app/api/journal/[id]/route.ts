import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { tradeJournal } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

/**
 * GET /api/journal/:id — single entry
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const entry = await db.query.tradeJournal.findFirst({
    where: and(eq(tradeJournal.id, id), eq(tradeJournal.userId, session.user.id)),
    with: { trade: true, signalExecution: true },
  });

  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(entry);
}

/**
 * PATCH /api/journal/:id — update entry
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();

  const existing = await db.query.tradeJournal.findFirst({
    where: and(eq(tradeJournal.id, id), eq(tradeJournal.userId, session.user.id)),
  });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const updateData: Record<string, unknown> = {};
  if (body.setupType !== undefined) updateData.setupType = body.setupType;
  if (body.reasoning !== undefined) updateData.reasoning = body.reasoning;
  if (body.review !== undefined) updateData.review = body.review;
  if (body.emotionalState !== undefined) updateData.emotionalState = body.emotionalState;
  if (body.rating !== undefined) updateData.rating = body.rating != null ? Number(body.rating) : null;
  if (body.tags !== undefined) updateData.tags = body.tags ? JSON.stringify(body.tags) : null;
  if (body.screenshotUrls !== undefined) updateData.screenshotUrls = body.screenshotUrls ? JSON.stringify(body.screenshotUrls) : null;
  if (body.symbol !== undefined) updateData.symbol = body.symbol;
  if (body.direction !== undefined) updateData.direction = body.direction;
  if (body.pnl !== undefined) updateData.pnl = body.pnl != null ? Number(body.pnl) : null;
  if (body.pnlPips !== undefined) updateData.pnlPips = body.pnlPips != null ? Number(body.pnlPips) : null;

  const [updated] = await db
    .update(tradeJournal)
    .set(updateData)
    .where(eq(tradeJournal.id, id))
    .returning();

  return NextResponse.json(updated);
}

/**
 * DELETE /api/journal/:id — delete entry
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const existing = await db.query.tradeJournal.findFirst({
    where: and(eq(tradeJournal.id, id), eq(tradeJournal.userId, session.user.id)),
  });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await db.delete(tradeJournal).where(eq(tradeJournal.id, id));
  return NextResponse.json({ success: true });
}
