import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { tradingAccounts } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { connectMetaApiAccount } from '@/lib/metaapi';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const accounts = await db.query.tradingAccounts.findMany({
    where: eq(tradingAccounts.userId, session.user.id),
    orderBy: (accounts, { desc }) => [desc(accounts.createdAt)],
  });

  return NextResponse.json(accounts);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { platform, server, login, password, name, accessMode } = await request.json();

    if (!platform || !server || !login || !password || !name) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
    }

    const account = await connectMetaApiAccount({
      platform: platform.toLowerCase() as 'mt4' | 'mt5',
      server,
      login,
      password,
      name: `Haia - ${name}`,
    });

    const [dbAccount] = await db
      .insert(tradingAccounts)
      .values({
        userId: session.user.id,
        name,
        platform: platform.toUpperCase(),
        metaApiId: account.id,
        server,
        login,
        currency: 'USD',
        accessMode: accessMode === 'trading' ? 'trading' : 'investor',
        syncStatus: 'pending',
      })
      .returning();

    return NextResponse.json(dbAccount, { status: 201 });
  } catch (error: unknown) {
    console.error('Account connection error:', error);
    const message = error instanceof Error ? error.message : 'Failed to connect account';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
