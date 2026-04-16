import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { copyGroups } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json();

  const group = await db.query.copyGroups.findFirst({
    where: and(eq(copyGroups.id, id), eq(copyGroups.userId, session.user.id)),
  });
  if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });

  const allowedFields: Record<string, unknown> = {};
  if (body.name !== undefined) allowedFields.name = body.name;
  if (body.isEnabled !== undefined) allowedFields.isEnabled = body.isEnabled;
  if (body.masterAccountId !== undefined) allowedFields.masterAccountId = body.masterAccountId;

  if (Object.keys(allowedFields).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const [updated] = await db.update(copyGroups).set(allowedFields).where(eq(copyGroups.id, id)).returning();
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const group = await db.query.copyGroups.findFirst({
    where: and(eq(copyGroups.id, id), eq(copyGroups.userId, session.user.id)),
  });
  if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });

  await db.delete(copyGroups).where(eq(copyGroups.id, id));
  return NextResponse.json({ success: true });
}
