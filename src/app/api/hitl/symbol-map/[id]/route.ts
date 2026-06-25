import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { deleteSymbolMap } from '@/lib/hitl/symbol-map';

/** DELETE /api/hitl/symbol-map/[id] — remove a mapping. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  await deleteSymbolMap(id);
  return NextResponse.json({ success: true });
}
