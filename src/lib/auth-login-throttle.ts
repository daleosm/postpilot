import { eq } from "drizzle-orm";

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
  const [attempt] = await db.select().from(authLoginAttempts).where(eq(authLoginAttempts.email, email)).limit(1);
  const windowExpired = !attempt || attempt.windowStartedAt.getTime() <= now.getTime() - LOGIN_FAILURE_WINDOW_MS;
  const failedAttempts = windowExpired ? 1 : attempt.failedAttempts + 1;
  const lockedUntil = failedAttempts >= LOGIN_FAILURE_LIMIT ? new Date(now.getTime() + LOGIN_LOCKOUT_MS) : null;

  if (!attempt) {
    await db.insert(authLoginAttempts).values({ email, failedAttempts, windowStartedAt: now, lastAttemptAt: now, lockedUntil });
    return;
  }

  await db.update(authLoginAttempts)
    .set({ failedAttempts, windowStartedAt: windowExpired ? now : attempt.windowStartedAt, lastAttemptAt: now, lockedUntil })
    .where(eq(authLoginAttempts.email, email));
}

export async function clearFailedLogins(email: string) {
  if (!db) return;
  await db.delete(authLoginAttempts).where(eq(authLoginAttempts.email, email));
}
