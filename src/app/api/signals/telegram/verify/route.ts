import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { signalSources } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getOrCreateAuthClient, clearAuthClient } from '@/lib/signals/telegram';

/**
 * POST /api/signals/telegram/verify
 * Completes Telegram auth — verifies the code and optional 2FA password.
 * Body: { code: string, phoneCodeHash: string, sourceId: string, password?: string }
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { code, phoneCodeHash, sourceId, password } = body;

  if (!code || !phoneCodeHash || !sourceId) {
    return NextResponse.json({ error: 'code, phoneCodeHash, and sourceId are required' }, { status: 400 });
  }

  const source = await db.query.signalSources.findFirst({
    where: eq(signalSources.id, sourceId),
  });

  if (!source || source.userId !== session.user.id) {
    return NextResponse.json({ error: 'Signal source not found' }, { status: 404 });
  }

  if (!source.telegramPhone) {
    return NextResponse.json({ error: 'No pending auth — call /auth first' }, { status: 400 });
  }

  try {
    const client = getOrCreateAuthClient();
    const sessionString = await client.signIn(
      source.telegramPhone,
      code,
      phoneCodeHash,
      password,
    );

    // Save session string and mark as connected
    await db
      .update(signalSources)
      .set({
        telegramSession: sessionString,
        telegramStatus: 'connected',
      })
      .where(eq(signalSources.id, sourceId));

    // Clean up the auth client — the worker will create its own
    clearAuthClient();

    return NextResponse.json({
      success: true,
      message: 'Telegram authenticated successfully. The signal listener will connect automatically.',
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // Check for 2FA requirement
    if (errorMsg.includes('SESSION_PASSWORD_NEEDED')) {
      await db
        .update(signalSources)
        .set({ telegramStatus: 'awaiting_2fa' })
        .where(eq(signalSources.id, sourceId));

      return NextResponse.json(
        { error: '2FA password required', requires2FA: true },
        { status: 400 },
      );
    }

    await db
      .update(signalSources)
      .set({ telegramStatus: 'error' })
      .where(eq(signalSources.id, sourceId));

    return NextResponse.json(
      { error: `Verification failed: ${errorMsg}` },
      { status: 500 },
    );
  }
}
