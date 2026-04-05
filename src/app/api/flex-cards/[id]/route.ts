import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { flexCards } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const card = await db.query.flexCards.findFirst({
    where: and(eq(flexCards.id, id), eq(flexCards.userId, session.user.id)),
  });

  if (!card) {
    return NextResponse.json({ error: 'Card not found' }, { status: 404 });
  }

  await db.delete(flexCards).where(eq(flexCards.id, id));

  return NextResponse.json({ success: true });
}
