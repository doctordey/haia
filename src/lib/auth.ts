import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { compare } from 'bcryptjs';
import { db } from '@/lib/db';
import { users, userRoles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

declare module 'next-auth' {
  interface User {
    roles?: string[];
  }
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
      roles: string[];
    };
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    id?: string;
    roles?: string[];
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
  trustHost: true,
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        try {
          if (!credentials?.email || !credentials?.password) {
            return null;
          }

          const email = credentials.email as string;
          const password = credentials.password as string;

          const user = await db.query.users.findFirst({
            where: eq(users.email, email),
          });

          if (!user || !user.password) {
            return null;
          }

          const passwordMatch = await compare(password, user.password);
          if (!passwordMatch) {
            return null;
          }

          // Fetch roles for this user
          const roles = await db
            .select({ role: userRoles.role })
            .from(userRoles)
            .where(eq(userRoles.userId, user.id));

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            image: user.avatarUrl,
            roles: roles.map((r) => r.role),
          };
        } catch (error) {
          console.error('Auth error:', error);
          return null;
        }
      },
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.roles = user.roles ?? [];
      }
      return token;
    },
    async session({ session, token }) {
      if (token?.id) {
        session.user.id = token.id as string;
      }
      session.user.roles = (token?.roles as string[]) ?? [];
      return session;
    },
  },
});
