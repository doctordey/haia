import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { signalConfigs } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * PATCH /api/signals/config/toggle — toggle isEnabled or dryRun
 * Body: { field: "isEnabled" | "dryRun", value: boolean }
 */
export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { field, value } = body;

  if (!['isEnabled', 'dryRun'].includes(field) || typeof value !== 'boolean') {
    return NextResponse.json({ error: 'Invalid field or value' }, { status: 400 });
  }

  const config = await db.query.signalConfigs.findFirst({
    where: eq(signalConfigs.userId, session.user.id),
  });

  if (!config) {
    return NextResponse.json({ error: 'No config found — set up first' }, { status: 404 });
  }

  const [updated] = await db
    .update(signalConfigs)
    .set({ [field]: value })
    .where(eq(signalConfigs.id, config.id))
    .returning();

  return NextResponse.json(updated);
}
