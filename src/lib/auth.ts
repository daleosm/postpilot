import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { ilike } from "drizzle-orm";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { z } from "zod";
import { cookies } from "next/headers";

import { db } from "@/lib/db";
import { resolveAuthSecret, shouldUseSecureAuthCookies } from "@/lib/auth-config";
import { clearFailedLogins, isLoginLocked, recordFailedLogin } from "@/lib/auth-login-throttle";
import { safeAuthRedirect } from "@/lib/auth-redirect";
import { getOrganizationMembershipsForUser } from "@/lib/organization-data";
import { verifyPassword } from "@/lib/password";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";

const authSecret = resolveAuthSecret();
const credentialsSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(1024),
});

const adapter = db
  ? DrizzleAdapter(db, {
      usersTable: users,
      accountsTable: accounts,
      sessionsTable: sessions,
      verificationTokensTable: verificationTokens,
    })
  : undefined;

export const authOptions: NextAuthOptions = {
  adapter,
  providers: [
    CredentialsProvider({
      id: "credentials",
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success || !db) return null;

        const email = parsed.data.email.toLowerCase().trim();
        if (await isLoginLocked(email)) return null;
        const [user] = await db.select().from(users).where(ilike(users.email, email)).limit(1);
        if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
          await recordFailedLogin(email);
          return null;
        }

        await clearFailedLogins(email);
        return user;
      },
    }),
  ],
  secret: authSecret,
  useSecureCookies: shouldUseSecureAuthCookies(),
  session: { strategy: "jwt" },
  pages: { signIn: "/sign-in" },
  callbacks: {
    async redirect({ url, baseUrl }) {
      return safeAuthRedirect(url, baseUrl);
    },
    async session({ session, user, token }) {
      const userId = user?.id ?? token.sub;
      if (!session.user || !userId) return session;

      const memberships = await getOrganizationMembershipsForUser(userId);
      session.user.id = userId;
      session.organizations = memberships;
      const requestedOrganizationId = (await cookies()).get("posthouse.activeOrganizationId")?.value;
      session.activeOrganizationId = memberships.some((membership) => membership.organizationId === requestedOrganizationId)
        ? requestedOrganizationId ?? null
        : memberships[0]?.organizationId ?? null;
      return session;
    },
  },
};
