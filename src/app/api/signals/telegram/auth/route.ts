import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { signalSources } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getOrCreateAuthClient } from '@/lib/signals/telegram';

/**
 * POST /api/signals/telegram/auth
 * Initiates Telegram auth — sends verification code to the user's phone.
 * Body: { phone: string, sourceId: string }
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { phone, sourceId } = body;

  if (!phone || !sourceId) {
    return NextResponse.json({ error: 'phone and sourceId are required' }, { status: 400 });
  }

  // Verify the source belongs to this user
  const source = await db.query.signalSources.findFirst({
    where: eq(signalSources.id, sourceId),
  });

  if (!source || source.userId !== session.user.id) {
    return NextResponse.json({ error: 'Signal source not found' }, { status: 404 });
  }

  try {
    const client = getOrCreateAuthClient();
    const authState = await client.sendCode(phone);

    // Store phone and update status
    await db
      .update(signalSources)
      .set({
        telegramPhone: phone,
        telegramStatus: 'awaiting_code',
      })
      .where(eq(signalSources.id, sourceId));

    return NextResponse.json({
      success: true,
      phoneCodeHash: authState.phoneCodeHash,
      message: 'Verification code sent to your Telegram app',
    });
  } catch (error) {
    console.error('[telegram-auth] Error sending code:', error);
    return NextResponse.json(
      { error: `Failed to send code: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
}
