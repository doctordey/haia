import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import {
  listAuthorizedUsers,
  addAuthorizedUser,
  getOperatorChatSetting,
  setOperatorChatSetting,
} from '@/lib/hitl/access';

/** GET /api/hitl/access — authorized users + the operator/group chat id. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [users, operatorChatId] = await Promise.all([listAuthorizedUsers(), getOperatorChatSetting()]);
  return NextResponse.json({ users, operatorChatId });
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

/** PATCH /api/hitl/access — set the operator/group chat id. Body: { operatorChatId }. */
export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const operatorChatId = typeof body?.operatorChatId === 'string' ? body.operatorChatId.trim() : '';

  // Telegram chat ids are integers; group/supergroup ids are negative.
  if (!/^-?\d+$/.test(operatorChatId)) {
    return NextResponse.json({ error: 'operatorChatId must be a numeric Telegram chat id (groups are negative)' }, { status: 400 });
  }
  await setOperatorChatSetting(operatorChatId);
  return NextResponse.json({ operatorChatId });
}
