import { expect, test } from "@playwright/test";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for OTP tests.");
const sql = postgres(databaseUrl, { prepare: false });
const userId = "otp-route-test-user";
const email = "otp-route-test@postpilot.test";

test.describe("OTP request boundary", () => {
  test.beforeAll(async () => {
    await sql`delete from users where id = ${userId} or email = ${email}`;
    await sql`delete from verification_tokens where identifier = ${email}`;
    await sql`insert into users (id, name, email) values (${userId}, 'OTP Route Test', ${email})`;
  });

  test.afterAll(async () => {
    await sql`delete from verification_tokens where identifier = ${email}`;
    await sql`delete from users where id = ${userId}`;
    await sql.end();
  });

  test("validates the request and keeps OTP responses non-enumerating", async ({ page }) => {
    expect((await page.request.post("/api/auth/request-otp", { data: { email: "not-an-email" } })).status()).toBe(400);

    const known = await page.request.post("/api/auth/request-otp", { data: { email: email.toUpperCase() } });
    const unknown = await page.request.post("/api/auth/request-otp", { data: { email: "unknown-otp-route-test@postpilot.test" } });
    expect(known.status()).toBe(200);
    expect(unknown.status()).toBe(200);
    await expect(known.json()).resolves.toEqual({ ok: true });
    await expect(unknown.json()).resolves.toEqual({ ok: true });
    expect(await sql`select identifier from verification_tokens where identifier = ${email}`).toHaveLength(1);
    expect(await sql`select identifier from verification_tokens where identifier = 'unknown-otp-route-test@postpilot.test'`).toHaveLength(0);
  });
});
