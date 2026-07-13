import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { decode } from '@auth/core/jwt';

const publicPaths = [
  '/', '/login', '/register', '/api/auth', '/api/health',
  '/api/signals/offset/webhook',
  // Public REST API — authenticated per-request by API key (Authorization:
  // Bearer / X-API-Key) inside each route, not by session cookie. The /haia/v1
  // pretty path is rewritten to /api/v1 (next.config); middleware runs before
  // the rewrite so both prefixes must be allowed here.
  '/api/v1', '/haia/v1',
  // HITL webhooks — authenticated by their own shared secret (TradingView can't
  // do session auth). The /api/hitl/symbol-map and /api/hitl/access management
  // routes are intentionally NOT public. Both the /api/* routes and the
  // /haia/* pretty paths (rewritten in next.config) must be allowed, because
  // middleware runs before the rewrite.
  '/api/hitl/tv-alert', '/api/hitl/tp1-hit',
  '/haia/hitl/tv-alert', '/haia/hitl/tp1-hit',
];

// Optional API-only hostname(s). When a request arrives on one of these hosts,
// only the public REST API is served and everything else 404s — so you can put
// the API on api.yourfund.com while the app lives elsewhere, without a second
// deployment. Comma-separated; matched case-insensitively, port ignored.
// Example: API_HOSTNAME="api.yourfund.com".
const API_HOSTNAMES = (process.env.API_HOSTNAME || '')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

function isApiHost(request: NextRequest): boolean {
  if (API_HOSTNAMES.length === 0) return false;
  const host = (request.headers.get('host') || '').toLowerCase().split(':')[0];
  return API_HOSTNAMES.includes(host);
}

// What the API-only host is allowed to serve (everything else → 404). Covers the
// versioned API, its /haia/v1 alias, and health. On this host a bare /v1/* path
// is also accepted and rewritten to /api/v1/* for a clean api.example.com/v1/… URL.
function isApiOnlyAllowed(pathname: string): boolean {
  return (
    pathname === '/api/health' ||
    pathname === '/v1' || pathname.startsWith('/v1/') ||
    pathname === '/api/v1' || pathname.startsWith('/api/v1/') ||
    pathname === '/haia/v1' || pathname.startsWith('/haia/v1/')
  );
}

// Routes that require specific roles (admin only — signals and journal are open to all authenticated users)
const ROLE_ROUTES: Record<string, string> = {
  '/settings/admin': 'admin',
  '/api/admin': 'admin',
};

function getRequiredRole(pathname: string): string | null {
  for (const [prefix, role] of Object.entries(ROLE_ROUTES)) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) {
      return role;
    }
  }
  return null;
}

async function getTokenPayload(request: NextRequest): Promise<Record<string, unknown> | null> {
  const cookieName = request.cookies.has('__Secure-authjs.session-token')
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';

  const token = request.cookies.get(cookieName)?.value;
  if (!token) return null;

  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) return null;

  try {
    const payload = await decode({ token, secret, salt: cookieName });
    return payload as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // API-only host: serve just the REST API, 404 everything else (app pages,
  // session-authed routes, HITL webhooks). Runs before any auth handling — the
  // API authenticates per-request by key, so no session/redirect logic applies.
  if (isApiHost(request)) {
    if (!isApiOnlyAllowed(pathname)) {
      return new NextResponse('Not found', { status: 404 });
    }
    // Bare /v1/* → /api/v1/* so the canonical URL on this host is short.
    if (pathname === '/v1' || pathname.startsWith('/v1/')) {
      const url = request.nextUrl.clone();
      url.pathname = '/api' + pathname;
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  }

  const isPublic = publicPaths.some(
    (path) => pathname === path || pathname.startsWith(path + '/')
  );

  if (isPublic) {
    return NextResponse.next();
  }

  const token = await getTokenPayload(request);

  if (!token) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Check role-based access
  const requiredRole = getRequiredRole(pathname);
  if (requiredRole) {
    const userRoles = (token.roles as string[]) ?? [];
    if (!userRoles.includes(requiredRole)) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { error: 'Forbidden: insufficient permissions' },
          { status: 403 }
        );
      }
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|themes|fonts).*)'],
};
