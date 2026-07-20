/** Returns only a same-origin path suitable for client-side navigation. */
export function safeCallbackPath(value: string | null | undefined) {
  if (!value) return "/";

  try {
    const localOrigin = "https://postpilot.local";
    const target = new URL(value, localOrigin);
    if (target.origin !== localOrigin) return "/";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/";
  }
}

/** Auth.js callback guard: never allow an authentication flow to leave this app. */
export function safeAuthRedirect(url: string, baseUrl: string) {
  try {
    const base = new URL(baseUrl);
    const target = new URL(url, base);
    if (target.origin !== base.origin) return base.toString();
    return target.toString();
  } catch {
    return baseUrl;
  }
}
