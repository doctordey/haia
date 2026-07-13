/**
 * Suppress MetaApi's engine.io websocket reconnect chatter from the process logs.
 *
 * On MetaApi's shared tier a 429 (rate limit) spins the SDK's socket reconnect
 * loop, which logs many lines/second — enough to hit the platform's log-rate cap
 * and get OUR logs dropped ("Messages dropped: N"). This installs a thin console
 * filter that drops only those known-noise lines; everything else passes through.
 *
 * Escape hatch: set HITL_VERBOSE_METAAPI_LOGS=true to disable the filter.
 */

// MetaApi-specific markers only. Generic Node frame names (_onTimeout,
// listOnTimeout, processTimers, component-emitter) are deliberately absent —
// they appear in the stack of ANY timer-driven error and would silently drop
// unrelated failures. The SDK logs whole Error objects (message + stack) in a
// single console call, so these specific markers match its noise regardless.
const NOISE = [
  'MetaApi websocket client',
  'reconnecting socket',
  'clientStickySocket',
  'xhr poll error',
  'polling-xhr',
  'engine.io-client',
  'agiliumtrade',
];

function isNoise(args: unknown[]): boolean {
  for (const a of args) {
    const text = typeof a === 'string' ? a : a instanceof Error ? `${a.message}\n${a.stack ?? ''}` : '';
    if (text && NOISE.some((n) => text.includes(n))) return true;
  }
  return false;
}

let installed = false;

export function installMetaApiLogFilter(): void {
  if (installed || process.env.HITL_VERBOSE_METAAPI_LOGS === 'true') return;
  installed = true;
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  for (const method of methods) {
    const orig = console[method].bind(console);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    console[method] = (...args: any[]) => {
      if (!isNoise(args)) orig(...args);
    };
  }
}
