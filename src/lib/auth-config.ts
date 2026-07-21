export function resolveAuthSecret(environment: NodeJS.ProcessEnv = process.env) {
  const secret = environment.NEXTAUTH_SECRET ?? (environment.NODE_ENV !== "production" ? "postpilot-local-development-secret" : undefined);
  if (!secret) throw new Error("NEXTAUTH_SECRET must be configured in production.");
  return secret;
}

export function shouldUseSecureAuthCookies(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.NODE_ENV !== "production") return false;

  // Production deployments normally use HTTPS. The local EKS port-forward is
  // intentionally http://localhost, however, and browsers will discard a
  // Secure cookie over that connection. Fail closed when no valid URL is set.
  const configuredUrl = environment.NEXTAUTH_URL?.trim();
  if (!configuredUrl) return true;

  try {
    return new URL(configuredUrl).protocol === "https:";
  } catch {
    return true;
  }
}
