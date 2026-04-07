import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { tradeJournal } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * GET /api/journal/tags — list all unique tags used by this user
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const entries = await db
    .select({ tags: tradeJournal.tags })
    .from(tradeJournal)
    .where(eq(tradeJournal.userId, session.user.id));

  const tagSet = new Set<string>();
  for (const entry of entries) {
    if (entry.tags) {
      try {
        const tags: string[] = JSON.parse(entry.tags);
        for (const tag of tags) tagSet.add(tag);
      } catch {}
    }
  }

  return NextResponse.json([...tagSet].sort());
}
