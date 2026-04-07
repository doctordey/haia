import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { signals, signalExecutions, signalConfigs } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';

/**
 * GET /api/signals — paginated list of signals with their executions
 * Query params: ?page=1&limit=50&instrument=NQ|ES
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const config = await db.query.signalConfigs.findFirst({
    where: eq(signalConfigs.userId, session.user.id),
  });
  if (!config) return NextResponse.json({ signals: [], pagination: { page: 1, totalPages: 0, total: 0 } });

  const { searchParams } = request.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit = Math.min(100, parseInt(searchParams.get('limit') || '50'));
  const offset = (page - 1) * limit;

  // Fetch signals for this config's source
  const allSignals = await db.query.signals.findMany({
    where: eq(signals.sourceId, config.sourceId),
    orderBy: [desc(signals.receivedAt)],
    limit,
    offset,
  });

  // For each signal, fetch its executions
  const signalIds = allSignals.map((s) => s.id);
  const allExecutions = signalIds.length > 0
    ? await db.select().from(signalExecutions).where(
        and(
          eq(signalExecutions.configId, config.id),
        )
      )
    : [];

  const executionMap = new Map<string, typeof allExecutions>();
  for (const exec of allExecutions) {
    const arr = executionMap.get(exec.signalId) || [];
    arr.push(exec);
    executionMap.set(exec.signalId, arr);
  }

  const result = allSignals.map((sig) => ({
    ...sig,
    executions: executionMap.get(sig.id) || [],
  }));

  // Count total signals
  const totalSignals = await db.query.signals.findMany({
    where: eq(signals.sourceId, config.sourceId),
    columns: { id: true },
  });

  return NextResponse.json({
    signals: result,
    pagination: {
      page,
      totalPages: Math.ceil(totalSignals.length / limit),
      total: totalSignals.length,
    },
  });
}
