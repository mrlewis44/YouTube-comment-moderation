// NextAuth (Auth.js v5) config: Google provider gated by the ALLOWED_EMAILS
// allowlist. This is app-level login only. YouTube API authorization (the
// refresh tokens that post/delete on a channel) is a separate flow and never
// lives in the browser session (SPEC Section 3).

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { ENV, isAllowedEmail } from "./env";
import { accessFor } from "./access";
import type { ChannelKey, Role } from "./domain";

declare module "next-auth" {
  interface Session {
    user: {
      email: string;
      name?: string | null;
      image?: string | null;
      role: Role;
      channels: ChannelKey[];
    };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: ENV.nextAuthSecret,
  // Trust the Vercel deployment host for callback URL construction.
  trustHost: true,
  providers: [
    Google({
      clientId: ENV.googleClientId,
      clientSecret: ENV.googleClientSecret,
    }),
  ],
  callbacks: {
    // Reject any Google account whose email is not on the allowlist.
    async signIn({ user }) {
      return isAllowedEmail(user.email);
    },
    async jwt({ token }) {
      const access = accessFor(token.email);
      token.role = access.role;
      token.channels = access.channels;
      return token;
    },
    async session({ session, token }) {
      session.user.role = (token.role as Role) ?? "member";
      session.user.channels = (token.channels as ChannelKey[]) ?? [];
      return session;
    },
  },
  pages: {
    signIn: "/signin",
  },
});
