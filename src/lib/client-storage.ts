type CookieOptions = {
  maxAgeSeconds?: number
  path?: string
  sameSite?: 'Lax' | 'Strict' | 'None'
  secure?: boolean
}

export function readCookieValue(cookieString: string, name: string): string | null {
  const encodedName = encodeURIComponent(name)
  const parts = cookieString.split(';')
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const rawKey = trimmed.slice(0, idx)
    if (rawKey === encodedName) {
      const rawValue = trimmed.slice(idx + 1)
      try {
        return decodeURIComponent(rawValue)
      } catch {
        return rawValue
      }
    }
  }
  return null
}

export function readCookieValueFromDocument(name: string): string | null {
  if (typeof document === 'undefined') return null
  return readCookieValue(document.cookie ?? '', name)
}

export function writeCookie(name: string, value: string, options?: CookieOptions) {
  if (typeof document === 'undefined') return

  const maxAgeSeconds = options?.maxAgeSeconds ?? 60 * 60 * 24 * 365
  const path = options?.path ?? '/'
  const sameSite = options?.sameSite ?? 'Lax'
  const secure =
    options?.secure ?? (process.env.NODE_ENV === 'production' ? true : false)

  const encodedName = encodeURIComponent(name)
  const encodedValue = encodeURIComponent(value)

  let cookie = `${encodedName}=${encodedValue}; Path=${path}; Max-Age=${maxAgeSeconds}; SameSite=${sameSite}`
  if (secure) cookie += '; Secure'
  document.cookie = cookie
}

export function readBooleanCookie(
  name: string,
  defaultValue: boolean
): boolean {
  const value = readCookieValueFromDocument(name)
  if (value === null) return defaultValue
  if (value === '1' || value === 'true') return true
  if (value === '0' || value === 'false') return false
  return defaultValue
}

export function safeSessionGetJson<T>(key: string): T | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function safeSessionSetJson(key: string, value: unknown) {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore sessionStorage quota/unavailable errors.
  }
}

