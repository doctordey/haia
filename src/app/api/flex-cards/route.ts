import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { flexCards } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cards = await db.query.flexCards.findMany({
    where: eq(flexCards.userId, session.user.id),
    orderBy: (cards, { desc }) => [desc(cards.createdAt)],
  });

  return NextResponse.json(cards);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const {
    accountId, title, period, metric, backgroundTheme, customBgUrl,
    showUsername, showChart, showWinLoss, showBranding,
    fontFamily, heroColor, labelColor, valueColor, usernameColor, brandingColor,
    layout, ctaTopLine, ctaBottomLine,
  } = body;

  if (!period || !metric) {
    return NextResponse.json({ error: 'Period and metric are required' }, { status: 400 });
  }

  const [card] = await db
    .insert(flexCards)
    .values({
      userId: session.user.id,
      accountId: accountId || null,
      title: title || null,
      period,
      metric,
      backgroundTheme: backgroundTheme || 'clean-minimal',
      customBgUrl: customBgUrl || null,
      showUsername: showUsername ?? true,
      showChart: showChart ?? true,
      showWinLoss: showWinLoss ?? true,
      showBranding: showBranding ?? true,
      fontFamily: fontFamily || 'inter',
      heroColor: heroColor ?? null,
      labelColor: labelColor || '#8B8D98',
      valueColor: valueColor || '#E8E9ED',
      usernameColor: usernameColor || '#E8E9ED',
      brandingColor: brandingColor || '#5A5C66',
      layout: layout || 'default',
      ctaTopLine: ctaTopLine || null,
      ctaBottomLine: ctaBottomLine || null,
    })
    .returning();

  return NextResponse.json(card, { status: 201 });
}
