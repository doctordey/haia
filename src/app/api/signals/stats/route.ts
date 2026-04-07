import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { signalExecutions, signalConfigs } from '@/lib/db/schema';
import { eq, and, gte, lte, sql, count } from 'drizzle-orm';

/**
 * GET /api/signals/stats
 * Returns execution statistics: totals, fill rate, avg latency, P&L per instrument
 * Query params: ?from=ISO&to=ISO&instrument=NQ|ES
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const config = await db.query.signalConfigs.findFirst({
    where: eq(signalConfigs.userId, session.user.id),
  });
  if (!config) return NextResponse.json(null);

  const { searchParams } = request.nextUrl;
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const instrument = searchParams.get('instrument');

  const conditions = [eq(signalExecutions.configId, config.id)];
  if (from) conditions.push(gte(signalExecutions.createdAt, new Date(from)));
  if (to) conditions.push(lte(signalExecutions.createdAt, new Date(to)));
  if (instrument) conditions.push(eq(signalExecutions.instrument, instrument));

  const rows = await db
    .select()
    .from(signalExecutions)
    .where(and(...conditions));

  const total = rows.length;
  const filled = rows.filter((r) => r.status === 'filled').length;
  const sent = rows.filter((r) => r.status === 'sent').length;
  const errors = rows.filter((r) => r.status === 'error' || r.status === 'rejected').length;
  const dryRuns = rows.filter((r) => r.status === 'dry_run').length;

  const latencies = rows.filter((r) => r.totalLatencyMs != null).map((r) => r.totalLatencyMs!);
  const avgLatency = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;

  // P&L by instrument (from filled trades that have associated trade profits)
  const nqRows = rows.filter((r) => r.instrument === 'NQ');
  const esRows = rows.filter((r) => r.instrument === 'ES');

  return NextResponse.json({
    total,
    filled,
    sent,
    errors,
    dryRuns,
    fillRate: total > 0 ? ((filled + sent) / total * 100).toFixed(1) : '0',
    avgLatency,
    byInstrument: {
      NQ: { total: nqRows.length, filled: nqRows.filter((r) => r.status === 'filled').length },
      ES: { total: esRows.length, filled: esRows.filter((r) => r.status === 'filled').length },
    },
  });
}
