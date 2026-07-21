import assert from "node:assert/strict";
import test from "node:test";

import { resolveAuthSecret, shouldUseSecureAuthCookies } from "../../src/lib/auth-config";
import { safeAuthRedirect, safeCallbackPath } from "../../src/lib/auth-redirect";
import { hashPassword, verifyPassword } from "../../src/lib/password";

test("password verifiers authenticate only the original password and use salts", async () => {
  const first = await hashPassword("password");
  const second = await hashPassword("password");

  assert.notEqual(first, second);
  assert.equal(await verifyPassword("password", first), true);
  assert.equal(await verifyPassword("not-password", first), false);
});

test("password verification safely rejects missing and malformed hashes", async () => {
  assert.equal(await verifyPassword("password", null), false);
  assert.equal(await verifyPassword("password", "not-a-password-hash"), false);
  assert.equal(await verifyPassword("password", "scrypt$missing"), false);
});

test("authentication configuration requires a production secret and secure cookies", () => {
  assert.throws(() => resolveAuthSecret({ NODE_ENV: "production" }), /NEXTAUTH_SECRET/);
  assert.equal(resolveAuthSecret({ NODE_ENV: "production", NEXTAUTH_SECRET: "secret" }), "secret");
  assert.equal(shouldUseSecureAuthCookies({ NODE_ENV: "production" }), true);
  assert.equal(shouldUseSecureAuthCookies({ NODE_ENV: "production", NEXTAUTH_URL: "https://postpilot.example" }), true);
  assert.equal(shouldUseSecureAuthCookies({ NODE_ENV: "production", NEXTAUTH_URL: "http://localhost:3000" }), false);
  assert.equal(shouldUseSecureAuthCookies({ NODE_ENV: "development" }), false);
});

test("authentication callbacks never navigate to another origin", () => {
  assert.equal(safeCallbackPath("/shows?filter=active"), "/shows?filter=active");
  assert.equal(safeCallbackPath("https://evil.example"), "/");
  assert.equal(safeCallbackPath("//evil.example"), "/");
  assert.equal(safeAuthRedirect("/shows", "https://postpilot.example"), "https://postpilot.example/shows");
  assert.equal(safeAuthRedirect("https://evil.example", "https://postpilot.example"), "https://postpilot.example/");
});
