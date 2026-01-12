/**
 * Client-side cookie utilities
 */

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${encodeURIComponent(name)}=`))
  if (!match) return null
  const value = match.split('=').slice(1).join('=')
  return decodeURIComponent(value)
}

export function writeCookie(name: string, value: string): void {
  const oneYearSeconds = 60 * 60 * 24 * 365
  let cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Path=/; Max-Age=${oneYearSeconds}; SameSite=Lax`
  if (process.env.NODE_ENV === 'production') cookie += '; Secure'
  document.cookie = cookie
}
