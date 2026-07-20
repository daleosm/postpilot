import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { authLoginAttempts } from "@/lib/db/schema";

export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_FAILURE_WINDOW_MS = 10 * 60 * 1000;
export const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

export async function isLoginLocked(email: string, now = new Date()) {
  if (!db) return true;
  const [attempt] = await db.select({ lockedUntil: authLoginAttempts.lockedUntil })
    .from(authLoginAttempts).where(eq(authLoginAttempts.email, email)).limit(1);
  return Boolean(attempt?.lockedUntil && attempt.lockedUntil > now);
}

/** Records a generic failed attempt for known and unknown addresses alike. */
export async function recordFailedLogin(email: string, now = new Date()) {
  if (!db) return;
  const windowStart = new Date(now.getTime() - LOGIN_FAILURE_WINDOW_MS);
  const lockUntil = new Date(now.getTime() + LOGIN_LOCKOUT_MS);
  // SQL fragments need encoded timestamp text; passing Date values through an
  // untyped expression bypasses the column encoder used by `.values()`.
  const windowStartSql = sql`${windowStart.toISOString()}::timestamptz`;
  const nowSql = sql`${now.toISOString()}::timestamptz`;
  const lockUntilSql = sql`${lockUntil.toISOString()}::timestamptz`;

  // This must be one statement: parallel failed sign-ins for the same address
  // must not overwrite each other's counter updates and evade the lockout.
  await db.insert(authLoginAttempts).values({
    email,
    failedAttempts: 1,
    windowStartedAt: now,
    lastAttemptAt: now,
    lockedUntil: null,
  }).onConflictDoUpdate({
    target: authLoginAttempts.email,
    set: {
      failedAttempts: sql`case when ${authLoginAttempts.windowStartedAt} <= ${windowStartSql} then 1 else ${authLoginAttempts.failedAttempts} + 1 end`,
      windowStartedAt: sql`case when ${authLoginAttempts.windowStartedAt} <= ${windowStartSql} then ${nowSql} else ${authLoginAttempts.windowStartedAt} end`,
      lastAttemptAt: now,
      lockedUntil: sql`case when ${authLoginAttempts.windowStartedAt} > ${windowStartSql} and ${authLoginAttempts.failedAttempts} + 1 >= ${LOGIN_FAILURE_LIMIT} then ${lockUntilSql} else null end`,
    },
  });
}

export async function clearFailedLogins(email: string) {
  if (!db) return;
  await db.delete(authLoginAttempts).where(eq(authLoginAttempts.email, email));
}
