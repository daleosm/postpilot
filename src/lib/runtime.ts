/** Development-only authentication bypass and role switcher. Never enabled in production. */
export const isDebugMode = process.env.NODE_ENV !== "production" && process.env.POSTPILOT_DEBUG_DEMO !== "false";

/** Mock fixtures are only used when a real database connection is unavailable. */
export const isDebugDemoMode = isDebugMode && !process.env.DATABASE_URL;
