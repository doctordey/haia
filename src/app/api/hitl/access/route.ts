import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { listAuthorizedUsers, addAuthorizedUser } from '@/lib/hitl/access';

/** GET /api/hitl/access — authorized users. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ users: await listAuthorizedUsers() });
}

/** POST /api/hitl/access — add/update an authorized user. Body: { telegramUserId, label? }. */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const telegramUserId = typeof body?.telegramUserId === 'string' ? body.telegramUserId.trim() : '';
  const label = typeof body?.label === 'string' ? body.label : undefined;

  if (!/^\d+$/.test(telegramUserId)) {
    return NextResponse.json({ error: 'telegramUserId must be numeric (e.g. 123456789)' }, { status: 400 });
  }
  const row = await addAuthorizedUser(telegramUserId, label);
  return NextResponse.json(row);
}
