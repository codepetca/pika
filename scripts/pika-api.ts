/**
 * pika-api.ts — Minimal authenticated client for Pika's teacher API.
 *
 * CLI probe (branch: cli-probe). Standalone: Node built-ins only, no deps.
 * Logs in via the same POST /api/auth/login path the browser uses, then
 * persists the `pika_session` cookie to .auth/pika-cli.json (gitignored) so
 * subsequent commands act as the logged-in teacher. No new server code — the
 * CLI is just a second consumer of the existing role-gated routes.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'

const SESSION_FILE = process.env.PIKA_SESSION_FILE || '.auth/pika-cli.json'
const SESSION_COOKIE_NAME = 'pika_session'

export interface SavedSession {
  cookie: string // "pika_session=<value>"
  baseUrl: string
  savedAt: string
  user?: { id: string; email: string; role: string }
}

/** Where the CLI talks to. Local dev by default; override for staging. */
export function getBaseUrl(): string {
  return process.env.PIKA_BASE_URL || process.env.E2E_BASE_URL || 'http://localhost:3000'
}

export function loadSession(): SavedSession | null {
  if (!existsSync(SESSION_FILE)) return null
  try {
    return JSON.parse(readFileSync(SESSION_FILE, 'utf8')) as SavedSession
  } catch {
    return null
  }
}

function saveSession(session: SavedSession): void {
  mkdirSync(dirname(SESSION_FILE), { recursive: true })
  writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2) + '\n', { mode: 0o600 })
}

function extractSessionCookie(res: Response): string | null {
  const all = res.headers.getSetCookie?.() ?? []
  for (const raw of all) {
    if (raw.startsWith(`${SESSION_COOKIE_NAME}=`)) {
      return raw.split(';')[0] // keep name=value, drop attributes
    }
  }
  return null
}

export async function login(email: string, password: string): Promise<SavedSession> {
  const baseUrl = getBaseUrl()
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const data = (await res.json().catch(() => ({}))) as { error?: string; user?: SavedSession['user'] }
  if (!res.ok) {
    throw new Error(`Login failed (${res.status}): ${data.error ?? res.statusText}`)
  }
  const cookie = extractSessionCookie(res)
  if (!cookie) {
    throw new Error('Login succeeded but no pika_session cookie was returned.')
  }
  const session: SavedSession = {
    cookie,
    baseUrl,
    savedAt: new Date().toISOString(),
    user: data.user,
  }
  saveSession(session)
  return session
}

export async function pikaFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const session = loadSession()
  if (!session) {
    throw new Error('Not logged in. Run: pnpm pika login')
  }
  const headers = new Headers(init.headers)
  headers.set('cookie', session.cookie)
  const res = await fetch(`${session.baseUrl}${path}`, { ...init, headers })
  if (res.status === 401) {
    throw new Error('Session expired or invalid. Run: pnpm pika login')
  }
  return res
}

export async function pikaJson<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await pikaFetch(path, init)
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} failed (${res.status}): ${data.error ?? res.statusText}`)
  }
  return data as T
}
