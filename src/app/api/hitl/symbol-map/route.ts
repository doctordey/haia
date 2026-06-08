import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { listSymbolMaps, upsertSymbolMap } from '@/lib/hitl/symbol-map';

/** GET /api/hitl/symbol-map — list all TradingView→broker mappings. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await listSymbolMaps());
}

/** POST /api/hitl/symbol-map — create or update a mapping. Body: { tvSymbol, brokerSymbol }. */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const tvSymbol = typeof body?.tvSymbol === 'string' ? body.tvSymbol.trim() : '';
  const brokerSymbol = typeof body?.brokerSymbol === 'string' ? body.brokerSymbol.trim() : '';

  if (!tvSymbol || !brokerSymbol) {
    return NextResponse.json({ error: 'Both tvSymbol and brokerSymbol are required' }, { status: 400 });
  }

  const row = await upsertSymbolMap(tvSymbol, brokerSymbol);
  return NextResponse.json(row);
}
