import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';

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

export default auth((request) => {
  const { pathname } = request.nextUrl;

  // Allow public paths
  const isPublic = publicPaths.some(
    (path) => pathname === path || pathname.startsWith(path + '/')
  );

  if (isPublic) {
    return NextResponse.next();
  }

  // Check for authenticated user
  const session = request.auth;

  if (!session?.user) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Check role-based access
  const requiredRole = getRequiredRole(pathname);
  if (requiredRole) {
    const userRoles: string[] = session.user.roles ?? [];
    if (!userRoles.includes(requiredRole)) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { error: 'Forbidden: insufficient permissions' },
          { status: 403 }
        );
      }
      // For page routes, redirect to dashboard
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|themes|fonts).*)'],
};
