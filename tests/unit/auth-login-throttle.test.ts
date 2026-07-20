import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";

import { LOGIN_FAILURE_LIMIT, LOGIN_FAILURE_WINDOW_MS, recordFailedLogin } from "../../src/lib/auth-login-throttle";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for login-throttle tests.");
const sql = postgres(databaseUrl, { prepare: false });
const email = "parallel-login-throttle@postpilot.test";

test("parallel failed credentials attempts cannot lose increments or bypass the lockout", async () => {
  await sql`delete from auth_login_attempts where email = ${email}`;
  const now = new Date("2035-01-01T10:00:00.000Z");

  await Promise.all(Array.from({ length: LOGIN_FAILURE_LIMIT }, () => recordFailedLogin(email, now)));

  const [attempt] = await sql<{ failed_attempts: number; locked_until: Date | null }[]>`
    select failed_attempts, locked_until from auth_login_attempts where email = ${email}
  `;
  assert.ok(attempt);
  assert.equal(attempt.failed_attempts, LOGIN_FAILURE_LIMIT);
  assert.ok(attempt.locked_until && attempt.locked_until > now);

  await recordFailedLogin(email, new Date(now.getTime() + LOGIN_FAILURE_WINDOW_MS + 1));
  const [reset] = await sql<{ failed_attempts: number; locked_until: Date | null }[]>`
    select failed_attempts, locked_until from auth_login_attempts where email = ${email}
  `;
  assert.equal(reset?.failed_attempts, 1);
  assert.equal(reset?.locked_until, null);
  await sql`delete from auth_login_attempts where email = ${email}`;
  await sql.end();
});
