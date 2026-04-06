import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { signals, signalExecutions, signalConfigs } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

/**
 * GET /api/signals/:id — single signal with all executions
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

  const config = await db.query.signalConfigs.findFirst({
    where: eq(signalConfigs.userId, session.user.id),
  });
  if (!config) return NextResponse.json({ error: 'No config' }, { status: 404 });

  const signal = await db.query.signals.findFirst({
    where: eq(signals.id, id),
  });
  if (!signal) return NextResponse.json({ error: 'Signal not found' }, { status: 404 });

  const executions = await db
    .select()
    .from(signalExecutions)
    .where(and(eq(signalExecutions.signalId, id), eq(signalExecutions.configId, config.id)));

  return NextResponse.json({ ...signal, executions });
}
