import assert from "node:assert/strict";
import test from "node:test";

// Node's native TypeScript runner requires the explicit extension; Next's
// TypeScript configuration deliberately does not enable that syntax globally.
// @ts-expect-error Node native type-strip test import
import { buildContentSecurityPolicy, securityResponseHeaders } from "../../src/lib/security-headers.ts";

test("production CSP trusts only the request nonce for script execution", () => {
  const policy = buildContentSecurityPolicy("test-nonce", false);

  assert.match(policy, /script-src 'self' 'nonce-test-nonce' 'strict-dynamic'/);
  assert.doesNotMatch(policy, /script-src[^;]*unsafe-inline/);
  assert.doesNotMatch(policy, /unsafe-eval/);
  assert.match(policy, /style-src 'self' 'nonce-test-nonce'/);
  assert.doesNotMatch(policy, /style-src\s[^;]*unsafe-inline/);
  assert.match(policy, /style-src-attr 'unsafe-inline'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /connect-src 'self' https:\/\/login\.microsoftonline\.com/);
});

test("development CSP retains only the eval exception Turbopack requires", () => {
  const policy = buildContentSecurityPolicy("test-nonce", true);

  assert.match(policy, /script-src[^;]*'unsafe-eval'/);
  assert.doesNotMatch(policy, /script-src[^;]*unsafe-inline/);
});

test("global headers protect static assets and preserve Entra popup support", () => {
  const headers = new Map(securityResponseHeaders.map((header) => [header.key, header.value]));

  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(headers.get("X-Frame-Options"), "DENY");
  assert.equal(headers.get("Cross-Origin-Opener-Policy"), "same-origin-allow-popups");
  assert.equal(headers.get("Cross-Origin-Resource-Policy"), "same-origin");
  assert.match(headers.get("Permissions-Policy") ?? "", /camera=\(\)/);
});
