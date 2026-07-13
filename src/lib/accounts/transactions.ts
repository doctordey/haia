/**
 * Validation for manually entered deposits/withdrawals. Manual rows are
 * indistinguishable from broker-synced ones on the public API: the generated
 * dealId is a broker-style numeric (no textual marker), matching the manual-
 * trade ticket convention.
 */

export interface ManualTransactionValues {
  dealId: string;
  kind: 'deposit' | 'withdrawal';
  amount: number;   // signed: deposits +, withdrawals −
  time: Date;
  comment: string | null;
}

function generateDealId(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
}

export function parseManualTransaction(body: Record<string, unknown>):
  | { values: ManualTransactionValues }
  | { error: string } {
  const kind = body.kind === 'withdrawal' ? 'withdrawal' : body.kind === 'deposit' ? 'deposit' : null;
  if (!kind) return { error: 'kind must be "deposit" or "withdrawal"' };

  const raw = Number(body.amount);
  if (!Number.isFinite(raw) || raw === 0) return { error: 'amount must be a non-zero number' };
  // Sign follows the kind regardless of how the amount was entered.
  const amount = kind === 'deposit' ? Math.abs(raw) : -Math.abs(raw);

  const time = body.time != null && body.time !== '' ? new Date(String(body.time)) : new Date();
  if (Number.isNaN(time.getTime())) return { error: 'time must be a valid date' };

  return {
    values: {
      dealId: generateDealId(),
      kind,
      amount,
      time,
      comment: body.comment != null && String(body.comment).trim() !== '' ? String(body.comment).trim() : null,
    },
  };
}
