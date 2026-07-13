import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { MESSAGE_DEFS, resetTemplate, loadTemplates, isMessageKey } from '@/lib/hitl/messages';

/**
 * DELETE /api/hitl/messages/[key] — reset a message to its default. For a
 * per-strategy variant (`<key>.forever`) this clears the Forever override, so
 * the returned value is whatever it now falls back to (the possibly-customised
 * base template, else the built-in default).
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { key } = await params;
  if (!isMessageKey(key)) return NextResponse.json({ error: 'Unknown message key' }, { status: 400 });

  await resetTemplate(key);

  const base = key.endsWith('.forever') ? key.slice(0, -'.forever'.length) : key;
  const def = MESSAGE_DEFS.find((d) => d.key === base)!;
  const templates = await loadTemplates();
  return NextResponse.json({ key, value: templates[base] ?? def.default });
}
