/** Development can bypass authentication to support local integration tests. */
export const isDevelopmentDebugMode = process.env.NODE_ENV !== "production" && process.env.POSTPILOT_DEBUG_DEMO !== "false";

/**
 * A public demo may expose the role switcher, but it still uses FastAPI
 * credential sessions. This must be explicitly enabled; production is off by
 * default.
 */
export const isPublicDemoMode = process.env.NODE_ENV === "production" && process.env.POSTPILOT_DEBUG_DEMO === "true";

/** Enables identity switching in either local development or the explicit demo. */
export const isDebugMode = isDevelopmentDebugMode || isPublicDemoMode;
