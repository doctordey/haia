import { describe, it, expect } from 'vitest';
import { isMessageKey, renderTemplate, MESSAGE_DEFS } from '@/lib/hitl/messages';

describe('per-strategy message keys', () => {
  it('accepts base keys and the .forever variant of per-strategy messages', () => {
    expect(isMessageKey('prompt')).toBe(true);
    expect(isMessageKey('prompt.forever')).toBe(true);
    expect(isMessageKey('confirm')).toBe(true);
  });

  it('rejects .forever variants of non-per-strategy messages and unknown keys', () => {
    expect(isMessageKey('confirm.forever')).toBe(false);   // confirm is not per-strategy
    expect(isMessageKey('nope')).toBe(false);
    expect(isMessageKey('nope.forever')).toBe(false);
    expect(isMessageKey('.forever')).toBe(false);
  });

  it('the alert prompt is marked per-strategy', () => {
    const prompt = MESSAGE_DEFS.find((d) => d.key === 'prompt');
    expect(prompt?.perStrategy).toBe(true);
  });
});

describe('renderTemplate with strategy variable', () => {
  it('substitutes {strategy} like any other variable', () => {
    expect(renderTemplate('New {strategy} signal: {symbol}', { strategy: 'Forever', symbol: 'XAUUSD' }))
      .toBe('New Forever signal: XAUUSD');
  });
});
