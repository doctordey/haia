import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { MESSAGE_DEFS, loadTemplates, setTemplate, isMessageKey } from '@/lib/hitl/messages';

/**
 * GET /api/hitl/messages — every message: label, variables, default, current
 * value. Per-strategy messages (the alert prompt) expand into two entries —
 * `<key>` (Unicorn) and `<key>.forever` — so each strategy's wording is edited
 * independently. The Forever variant falls back to the Unicorn template until
 * it's customised.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const templates = await loadTemplates();
  const messages = MESSAGE_DEFS.flatMap((d) => {
    const base = {
      key: d.key,
      label: d.perStrategy ? `${d.label} — Unicorn` : d.label,
      description: d.description,
      variables: d.variables,
      default: d.default,
      value: templates[d.key] ?? d.default,
    };
    if (!d.perStrategy) return [base];
    return [
      base,
      {
        key: `${d.key}.forever`,
        label: `${d.label} — Forever`,
        description: 'Forever-specific wording. Until you save one, Forever signals use the Unicorn template above.',
        variables: d.variables,
        default: d.default,
        value: templates[`${d.key}.forever`] ?? templates[d.key] ?? d.default,
      },
    ];
  });
  return NextResponse.json({ messages });
}

/** PATCH /api/hitl/messages — set one template. Body: { key, template }. */
export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const key = typeof body?.key === 'string' ? body.key : '';
  const template = typeof body?.template === 'string' ? body.template : '';

  if (!isMessageKey(key)) {
    return NextResponse.json({ error: 'Unknown message key' }, { status: 400 });
  }
  if (!template.trim()) {
    return NextResponse.json({ error: 'Template cannot be empty' }, { status: 400 });
  }

  await setTemplate(key, template);
  return NextResponse.json({ key, value: template });
}
