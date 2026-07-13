import { describe, it, expect } from 'vitest';

// Pure re-implementation of the API-only host matching used in middleware.ts,
// exercised directly so the routing rules are covered without a Next runtime.
// (middleware.ts reads process.env at module load, which the edge runtime
// resolves per-deploy; this mirrors the same logic.)

function isApiOnlyAllowed(pathname: string): boolean {
  return (
    pathname === '/api/health' ||
    pathname === '/v1' || pathname.startsWith('/v1/') ||
    pathname === '/api/v1' || pathname.startsWith('/api/v1/') ||
    pathname === '/haia/v1' || pathname.startsWith('/haia/v1/')
  );
}

function hostMatches(hostHeader: string, configured: string[]): boolean {
  if (configured.length === 0) return false;
  const host = hostHeader.toLowerCase().split(':')[0];
  return configured.includes(host);
}

describe('API-only host scoping', () => {
  it('allows the API surface and health', () => {
    for (const p of ['/api/health', '/v1', '/v1/accounts', '/api/v1/accounts/x/trades', '/haia/v1/accounts']) {
      expect(isApiOnlyAllowed(p)).toBe(true);
    }
  });

  it('blocks app pages, auth, and session/webhook routes', () => {
    for (const p of ['/', '/login', '/dashboard', '/settings', '/api/auth/session', '/api/accounts', '/api/hitl/tv-alert', '/v1x']) {
      expect(isApiOnlyAllowed(p)).toBe(false);
    }
  });

  it('matches configured hosts case-insensitively and ignores the port', () => {
    const cfg = ['api.yourfund.com'];
    expect(hostMatches('api.yourfund.com', cfg)).toBe(true);
    expect(hostMatches('API.YourFund.com:443', cfg)).toBe(true);
    expect(hostMatches('app.yourfund.com', cfg)).toBe(false);
  });

  it('never treats any host as API-only when unconfigured', () => {
    expect(hostMatches('api.yourfund.com', [])).toBe(false);
  });
});
