import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { listChats, addChat } from '@/lib/hitl/access';

/** GET /api/hitl/chats — operator destinations (DM + group(s)). */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ chats: await listChats() });
}

/** POST /api/hitl/chats — add a destination. Body: { chatId, label? }. */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const chatId = typeof body?.chatId === 'string' ? body.chatId.trim() : '';
  const label = typeof body?.label === 'string' ? body.label : undefined;

  // Telegram chat ids are integers; group/supergroup ids are negative.
  if (!/^-?\d+$/.test(chatId)) {
    return NextResponse.json({ error: 'chatId must be a numeric Telegram chat id (groups are negative)' }, { status: 400 });
  }
  const row = await addChat(chatId, label);
  return NextResponse.json(row);
}
