/**
 * Browser-facing security headers shared by Next configuration and the edge
 * proxy. Keep these framework-agnostic so the policy is easy to exercise in
 * lightweight Node tests as well as in the running application.
 */
export const securityResponseHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
  // `same-origin-allow-popups` keeps the opener relationship needed by the
  // existing Microsoft Entra redirect/popup flow while protecting ordinary
  // cross-origin navigations.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
] as const;

/**
 * A nonce lets Next mark its own generated scripts as trusted without allowing
 * arbitrary inline scripts. Development needs `unsafe-eval` for Turbopack's
 * source maps; production deliberately omits it.
 */
export function buildContentSecurityPolicy(nonce: string, isDevelopment = process.env.NODE_ENV !== "production") {
  const scriptSources = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"];
  if (isDevelopment) scriptSources.push("'unsafe-eval'");

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    // Next can nonce its emitted style elements. React's style attributes are
    // kept separately for the Gantt/layout calculations; they cannot load a
    // stylesheet or execute JavaScript.
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https://login.microsoftonline.com https://*.msauth.net https://*.msftauth.net",
    "frame-src https://login.microsoftonline.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
