import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { MESSAGE_DEFS, resetTemplate } from '@/lib/hitl/messages';

/** DELETE /api/hitl/messages/[key] — reset a message to its default. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { key } = await params;
  const def = MESSAGE_DEFS.find((d) => d.key === key);
  if (!def) return NextResponse.json({ error: 'Unknown message key' }, { status: 400 });

  await resetTemplate(key);
  return NextResponse.json({ key, value: def.default });
}
