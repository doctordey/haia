import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { copyGroups, tradingAccounts } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const groups = await db.query.copyGroups.findMany({
    where: eq(copyGroups.userId, session.user.id),
    with: {
      masterAccount: true,
      slaves: {
        with: { account: true, symbolMaps: true },
      },
    },
    orderBy: (g, { desc }) => [desc(g.createdAt)],
  });

  return NextResponse.json(groups);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { name, masterAccountId } = body;

  if (!name || !masterAccountId) {
    return NextResponse.json({ error: 'name and masterAccountId are required' }, { status: 400 });
  }

  const account = await db.query.tradingAccounts.findFirst({
    where: and(eq(tradingAccounts.id, masterAccountId), eq(tradingAccounts.userId, session.user.id)),
  });
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  const [group] = await db.insert(copyGroups).values({
    userId: session.user.id,
    name,
    masterAccountId,
  }).returning();

  return NextResponse.json(group, { status: 201 });
}
