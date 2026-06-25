import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { deleteAuthorizedUser } from '@/lib/hitl/access';

/** DELETE /api/hitl/access/[id] — remove an authorized user. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  await deleteAuthorizedUser(id);
  return NextResponse.json({ success: true });
}
