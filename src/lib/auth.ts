import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { and, eq } from "drizzle-orm";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { z } from "zod";
import { cookies } from "next/headers";

import { db } from "@/lib/db";
import { getOrganizationMembershipsForUser } from "@/lib/organization-data";
import { hashOtp } from "@/lib/otp";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";

const authSecret = process.env.NEXTAUTH_SECRET ?? (process.env.NODE_ENV !== "production" ? "postpilot-local-development-secret" : undefined);
const credentialsSchema = z.object({ email: z.string().email(), code: z.string().regex(/^\d{6}$/) });

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
      id: "email-otp",
      name: "Email one-time passcode",
      credentials: { email: { label: "Email", type: "email" }, code: { label: "Code", type: "text" } },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success || !db) return null;

        const email = parsed.data.email.toLowerCase().trim();
        const token = hashOtp(email, parsed.data.code);
        const [verification] = await db.select().from(verificationTokens).where(and(eq(verificationTokens.identifier, email), eq(verificationTokens.token, token))).limit(1);

        if (!verification || verification.expires < new Date()) return null;

        await db.delete(verificationTokens).where(and(eq(verificationTokens.identifier, email), eq(verificationTokens.token, token)));
        const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        return user ?? null;
      },
    }),
  ],
  secret: authSecret,
  session: { strategy: "jwt" },
  pages: { signIn: "/sign-in" },
  callbacks: {
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
