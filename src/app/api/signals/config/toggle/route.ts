import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { signalConfigs } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

/**
 * PATCH /api/signals/config/toggle — toggle isEnabled or dryRun for a specific config
 * Body: { configId: string, field: "isEnabled" | "dryRun", value: boolean }
 */
export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { configId, field, value } = body;

  if (!['isEnabled', 'dryRun'].includes(field) || typeof value !== 'boolean') {
    return NextResponse.json({ error: 'Invalid field or value' }, { status: 400 });
  }

  if (!configId) {
    return NextResponse.json({ error: 'configId is required' }, { status: 400 });
  }

  const config = await db.query.signalConfigs.findFirst({
    where: and(eq(signalConfigs.id, configId), eq(signalConfigs.userId, session.user.id)),
  });

  if (!config) {
    return NextResponse.json({ error: 'Config not found' }, { status: 404 });
  }

  const [updated] = await db
    .update(signalConfigs)
    .set({ [field]: value })
    .where(eq(signalConfigs.id, configId))
    .returning();

  return NextResponse.json(updated);
}
