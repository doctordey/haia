import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { signals, signalExecutions, signalConfigs, signalSources } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

/**
 * GET /api/signals/:id — single signal with all executions
 * Ownership: verifies signal belongs to a source owned by the user
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

  const signal = await db.query.signals.findFirst({
    where: eq(signals.id, id),
  });
  if (!signal) return NextResponse.json({ error: 'Signal not found' }, { status: 404 });

  // Verify ownership: signal's source must belong to the user
  const source = await db.query.signalSources.findFirst({
    where: and(eq(signalSources.id, signal.sourceId), eq(signalSources.userId, session.user.id)),
  });
  if (!source) return NextResponse.json({ error: 'Signal not found' }, { status: 404 });

  // Get the user's config to filter executions
  const config = await db.query.signalConfigs.findFirst({
    where: eq(signalConfigs.userId, session.user.id),
  });

  const executions = config
    ? await db
        .select()
        .from(signalExecutions)
        .where(and(eq(signalExecutions.signalId, id), eq(signalExecutions.configId, config.id)))
    : [];

  return NextResponse.json({ ...signal, executions });
}
