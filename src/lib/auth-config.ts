export function resolveAuthSecret(environment: NodeJS.ProcessEnv = process.env) {
  const secret = environment.NEXTAUTH_SECRET ?? (environment.NODE_ENV !== "production" ? "postpilot-local-development-secret" : undefined);
  if (!secret) throw new Error("NEXTAUTH_SECRET must be configured in production.");
  return secret;
}

export function shouldUseSecureAuthCookies(environment: NodeJS.ProcessEnv = process.env) {
  return environment.NODE_ENV === "production";
}
