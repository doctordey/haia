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
