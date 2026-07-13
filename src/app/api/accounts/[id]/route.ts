import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { tradingAccounts, trades, dailySnapshots, accountStats } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { removeMetaApiAccount } from '@/lib/metaapi';
import { buildLabelUpdate } from '@/app/api/v1/accounts/[id]/route';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const account = await db.query.tradingAccounts.findFirst({
    where: and(eq(tradingAccounts.id, id), eq(tradingAccounts.userId, session.user.id)),
    with: { accountStats: true },
  });

  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  return NextResponse.json(account);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();

  const account = await db.query.tradingAccounts.findFirst({
    where: and(eq(tradingAccounts.id, id), eq(tradingAccounts.userId, session.user.id)),
  });

  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  // Upgrade to trading password — recreate the MetaApi account with the new password
  if (body.tradingPassword) {
    try {
      // Remove old MetaApi account
      try { await removeMetaApiAccount(account.metaApiId); } catch {}

      // Create new one with trading password
      const { connectMetaApiAccount } = await import('@/lib/metaapi');
      const newAccount = await connectMetaApiAccount({
        platform: account.platform.toLowerCase() as 'mt4' | 'mt5',
        server: account.server,
        login: account.login,
        password: body.tradingPassword,
        name: `Haia - ${account.name}`,
      });

      const [updated] = await db
        .update(tradingAccounts)
        .set({ metaApiId: newAccount.id, accessMode: 'trading' })
        .where(eq(tradingAccounts.id, id))
        .returning();

      return NextResponse.json(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upgrade';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // Toggle HITL (human-in-the-loop) execution for this account.
  if (typeof body.hitlEnabled === 'boolean') {
    // Arming requires full trading access — an investor (read-only) login can't place orders.
    if (body.hitlEnabled && account.accessMode !== 'trading') {
      return NextResponse.json(
        { error: 'This account is read-only (investor access). Upgrade to a trading password before enabling Unicorn.' },
        { status: 400 },
      );
    }

    // Multiple accounts may be armed simultaneously — an approved trade mirrors
    // to every armed account (each sized independently). The worker resolves the
    // full armed set at dispatch time.
    const [updated] = await db
      .update(tradingAccounts)
      .set({ hitlEnabled: body.hitlEnabled })
      .where(eq(tradingAccounts.id, id))
      .returning();

    return NextResponse.json(updated);
  }

  // Label overrides (account name / number / live-demo exposed via the REST API)
  // and the manual/live distinction toggle. Shares the validation used by the
  // public v1 PATCH so the rules stay identical.
  const labelKeys = ['labelName', 'labelLogin', 'labelType', 'accountType', 'distinguishManual'];
  if (labelKeys.some((k) => k in body)) {
    const result = buildLabelUpdate(body);
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });
    if (Object.keys(result.set).length > 0) {
      const [updated] = await db
        .update(tradingAccounts)
        .set(result.set)
        .where(eq(tradingAccounts.id, id))
        .returning();
      return NextResponse.json(updated);
    }
  }

  return NextResponse.json({ error: 'No update fields provided' }, { status: 400 });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const account = await db.query.tradingAccounts.findFirst({
    where: and(eq(tradingAccounts.id, id), eq(tradingAccounts.userId, session.user.id)),
  });

  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  try {
    await removeMetaApiAccount(account.metaApiId);
  } catch (error) {
    console.error('Failed to remove MetaApi account:', error);
  }

  await db.delete(accountStats).where(eq(accountStats.accountId, id));
  await db.delete(dailySnapshots).where(eq(dailySnapshots.accountId, id));
  await db.delete(trades).where(eq(trades.accountId, id));
  await db.delete(tradingAccounts).where(eq(tradingAccounts.id, id));

  return NextResponse.json({ success: true });
}
