export const AUTH_SESSION_MAX_AGE_SECONDS = 180 * 24 * 60 * 60
// Keep the encrypted seal valid through the browser cookie's full lifetime.
// iron-session reserves 60 seconds for server/client clock skew.
export const AUTH_SESSION_TTL_SECONDS = AUTH_SESSION_MAX_AGE_SECONDS + 60
export const AUTH_SESSION_VERSION = 3 as const
