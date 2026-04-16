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
    const body = await request.json();
    const { platform, name } = body;

    if (!platform || !name) {
      return NextResponse.json({ error: 'Platform and name are required' }, { status: 400 });
    }

    // ─── Tradovate ─────────────────────────────────────
    if (platform.toLowerCase() === 'tradovate') {
      const { tradovateUsername, tradovatePassword, tradovateApiSecret, tradovateCid, tradovateEnvironment, tradovateAccountId } = body;
      if (!tradovateUsername || !tradovatePassword) {
        return NextResponse.json({ error: 'Tradovate username and password are required' }, { status: 400 });
      }

      // Verify credentials by attempting auth
      try {
        const authUrl = tradovateEnvironment === 'live'
          ? 'https://live.tradovateapi.com/v1/auth/accessTokenRequest'
          : 'https://demo.tradovateapi.com/v1/auth/accessTokenRequest';

        const authRes = await fetch(authUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: tradovateUsername,
            password: tradovatePassword,
            appId: 'Haia',
            appVersion: '1.0.0',
            cid: tradovateCid || 8,
            sec: tradovateApiSecret || '',
          }),
        });

        if (!authRes.ok) {
          const errText = await authRes.text();
          return NextResponse.json({ error: `Tradovate auth failed: ${errText}` }, { status: 400 });
        }

        const authData = await authRes.json();

        // If no account ID provided, fetch accounts list and use the first one
        let resolvedAccountId = tradovateAccountId;
        if (!resolvedAccountId) {
          const baseUrl = tradovateEnvironment === 'live'
            ? 'https://live.tradovateapi.com/v1'
            : 'https://demo.tradovateapi.com/v1';
          const acctRes = await fetch(`${baseUrl}/account/list`, {
            headers: { 'Authorization': `Bearer ${authData.accessToken}` },
          });
          if (acctRes.ok) {
            const accounts = await acctRes.json();
            if (accounts.length > 0) resolvedAccountId = String(accounts[0].id);
          }
        }

        const [dbAccount] = await db
          .insert(tradingAccounts)
          .values({
            userId: session.user.id,
            name,
            platform: 'TRADOVATE',
            currency: 'USD',
            accessMode: 'trading',
            syncStatus: 'synced',
            tradovateAccountId: resolvedAccountId || null,
            tradovateUsername,
            tradovatePassword,
            tradovateApiKey: body.tradovateApiKey || null,
            tradovateApiSecret: tradovateApiSecret || null,
            tradovateEnvironment: tradovateEnvironment || 'demo',
            tradovateCid: tradovateCid || null,
          })
          .returning();

        return NextResponse.json(dbAccount, { status: 201 });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Tradovate connection failed';
        return NextResponse.json({ error: message }, { status: 500 });
      }
    }

    // ─── MT4 / MT5 ─────────────────────────────────────
    const { server, login, password, accessMode } = body;
    if (!server || !login || !password) {
      return NextResponse.json({ error: 'Server, login, and password are required' }, { status: 400 });
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
