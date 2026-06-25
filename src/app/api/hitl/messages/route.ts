import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { MESSAGE_DEFS, loadTemplates, setTemplate } from '@/lib/hitl/messages';

/** GET /api/hitl/messages — every message: label, variables, default, current value. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const templates = await loadTemplates();
  const messages = MESSAGE_DEFS.map((d) => ({
    key: d.key,
    label: d.label,
    description: d.description,
    variables: d.variables,
    default: d.default,
    value: templates[d.key] ?? d.default,
  }));
  return NextResponse.json({ messages });
}

/** PATCH /api/hitl/messages — set one template. Body: { key, template }. */
export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const key = typeof body?.key === 'string' ? body.key : '';
  const template = typeof body?.template === 'string' ? body.template : '';

  if (!MESSAGE_DEFS.some((d) => d.key === key)) {
    return NextResponse.json({ error: 'Unknown message key' }, { status: 400 });
  }
  if (!template.trim()) {
    return NextResponse.json({ error: 'Template cannot be empty' }, { status: 400 });
  }

  await setTemplate(key, template);
  return NextResponse.json({ key, value: template });
}
