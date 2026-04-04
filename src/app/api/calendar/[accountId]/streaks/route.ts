import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { tradingAccounts, dailySnapshots } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { accountId } = await params;

  const account = await db.query.tradingAccounts.findFirst({
    where: and(eq(tradingAccounts.id, accountId), eq(tradingAccounts.userId, session.user.id)),
  });

  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  // Get all snapshots ordered by date desc
  const snapshots = await db.query.dailySnapshots.findMany({
    where: eq(dailySnapshots.accountId, accountId),
    orderBy: (snap, { desc }) => [desc(snap.date)],
  });

  if (snapshots.length === 0) {
    return NextResponse.json({
      currentStreak: 0,
      bestStreak: 0,
      bestStreakMonth: null,
    });
  }

  // Current positive streak (from most recent day backwards)
  let currentStreak = 0;
  for (const snap of snapshots) {
    if (snap.pnl > 0) {
      currentStreak++;
    } else {
      break;
    }
  }

  // Best streak overall + by month
  const chronological = [...snapshots].reverse();
  let bestStreak = 0;
  let tempStreak = 0;
  let bestStreakMonth: string | null = null;
  let tempStreakStartMonth: string | null = null;

  for (const snap of chronological) {
    if (snap.pnl > 0) {
      tempStreak++;
      if (tempStreak === 1) {
        tempStreakStartMonth = snap.date.slice(0, 7); // yyyy-MM
      }
      if (tempStreak > bestStreak) {
        bestStreak = tempStreak;
        bestStreakMonth = tempStreakStartMonth;
      }
    } else {
      tempStreak = 0;
      tempStreakStartMonth = null;
    }
  }

  return NextResponse.json({
    currentStreak,
    bestStreak,
    bestStreakMonth,
  });
}
