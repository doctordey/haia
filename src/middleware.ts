import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';

const publicPaths = ['/', '/login', '/register', '/api/auth', '/api/health'];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  const isPublic = publicPaths.some(
    (path) => pathname === path || pathname.startsWith(path + '/')
  );

  if (isPublic) {
    return NextResponse.next();
  }

  if (!req.auth) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|themes|fonts).*)'],
};
