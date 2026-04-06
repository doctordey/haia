import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { decode } from '@auth/core/jwt';

const publicPaths = ['/', '/login', '/register', '/api/auth', '/api/health'];

// Routes that require specific roles
const ROLE_ROUTES: Record<string, string> = {
  '/signals': 'signals',
  '/api/signals': 'signals',
  '/journal': 'journal',
  '/api/journal': 'journal',
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
