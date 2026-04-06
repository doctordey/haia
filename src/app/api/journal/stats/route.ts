import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { tradeJournal } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * GET /api/journal/stats — performance breakdown by setup type and emotional state
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const entries = await db
    .select()
    .from(tradeJournal)
    .where(eq(tradeJournal.userId, session.user.id));

  const withPnl = entries.filter((e) => e.pnl != null);

  // By setup type
  const bySetup = new Map<string, { count: number; wins: number; totalPnl: number }>();
  for (const e of withPnl) {
    const key = e.setupType || 'Unknown';
    const curr = bySetup.get(key) || { count: 0, wins: 0, totalPnl: 0 };
    curr.count++;
    if (e.pnl! > 0) curr.wins++;
    curr.totalPnl += e.pnl!;
    bySetup.set(key, curr);
  }

  // By emotional state
  const byEmotion = new Map<string, { count: number; wins: number; totalPnl: number }>();
  for (const e of withPnl) {
    const key = e.emotionalState || 'Unknown';
    const curr = byEmotion.get(key) || { count: 0, wins: 0, totalPnl: 0 };
    curr.count++;
    if (e.pnl! > 0) curr.wins++;
    curr.totalPnl += e.pnl!;
    byEmotion.set(key, curr);
  }

  // Rating distribution
  const byRating = [0, 0, 0, 0, 0]; // index 0=1star ... index 4=5stars
  for (const e of entries) {
    if (e.rating && e.rating >= 1 && e.rating <= 5) {
      byRating[e.rating - 1]++;
    }
  }

  // Tag frequency
  const tagCounts = new Map<string, number>();
  for (const e of entries) {
    if (e.tags) {
      try {
        const tags: string[] = JSON.parse(e.tags);
        for (const tag of tags) {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }
      } catch {}
    }
  }

  return NextResponse.json({
    total: entries.length,
    withPnl: withPnl.length,
    bySetup: Object.fromEntries(
      [...bySetup.entries()].map(([k, v]) => [k, { ...v, winRate: v.count > 0 ? ((v.wins / v.count) * 100).toFixed(1) : '0' }]),
    ),
    byEmotion: Object.fromEntries(
      [...byEmotion.entries()].map(([k, v]) => [k, { ...v, winRate: v.count > 0 ? ((v.wins / v.count) * 100).toFixed(1) : '0' }]),
    ),
    byRating,
    topTags: [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([tag, count]) => ({ tag, count })),
  });
}
