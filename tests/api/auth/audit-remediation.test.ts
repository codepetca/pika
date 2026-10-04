import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

interface Row { [key: string]: unknown }
const state = vi.hoisted(() => ({
  user: {} as Row, codes: [] as Row[], passwordWrites: [] as string[], sessions: [] as unknown[][],
  hashBarrier: null as Promise<void> | null, hashCount: 0,
  verifyBarrier: null as Promise<void> | null, verifyCount: 0, token: 0,
}))
vi.mock('@/lib/auth', () => ({ createSession: vi.fn(async (...args: unknown[]) => { state.sessions.push(args) }) }))
vi.mock('@/lib/server/auth-rate-limit', () => ({
  consumeAuthRequestRateLimits: vi.fn(async () => {}), clearAuthRateLimit: vi.fn(async () => {}),
}))
vi.mock('@/lib/crypto', () => ({
  verifyCode: vi.fn(async (code: string, hash: string) => {
    state.verifyCount++
    if (state.verifyBarrier) await state.verifyBarrier
    return code === hash
  }),
  generateHandoffToken: () => 'handoff-token-' + String(++state.token).padStart(35, '0'),
  hashHandoffToken: (token: string) => token,
  hashPassword: vi.fn(async (password: string) => {
    state.hashCount++
    if (state.hashBarrier) await state.hashBarrier
    return 'hash_' + password
  }),
  verifyPassword: vi.fn(async (password: string, hash: string) => hash === 'hash_' + password),
}))

// Execute each update's predicates at write time, modeling PostgreSQL's
// recheck after a competing update rather than returning unconditional mocks.
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ from: (table: string) => {
  let patch: Row | null = null
  const predicates: Array<(row: Row) => boolean> = []
  const execute = () => {
    const rows = (table === 'users' ? [state.user] : state.codes).filter(row => predicates.every(test => test(row)))
    if (patch) for (const row of rows) {
      Object.assign(row, patch)
      if (table === 'users' && typeof patch.password_hash === 'string') state.passwordWrites.push(patch.password_hash)
    }
    return { data: rows.map(row => ({ ...row })), error: null }
  }
  const builder: any = {
    select: () => builder,
    update: (value: Row) => { patch = value; return builder },
    eq: (key: string, value: unknown) => { predicates.push(row => row[key] === value); return builder },
    is: (key: string, value: unknown) => { predicates.push(row => row[key] === value); return builder },
    gt: (key: string, value: string) => { predicates.push(row => String(row[key]) > value); return builder },
    order: async () => { const result = execute(); result.data.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))); return result },
    single: async () => { const result = execute(); return { ...result, data: result.data[0] || null } },
    maybeSingle: async () => { const result = execute(); return { ...result, data: result.data[0] || null } },
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(execute()).then(resolve, reject),
  }
  return builder
} }) }))

import { POST as verifySignup } from '@/app/api/auth/verify-signup/route'
import { POST as verifyReset } from '@/app/api/auth/reset-password/verify/route'
import { POST as createPassword } from '@/app/api/auth/create-password/route'
import { POST as login } from '@/app/api/auth/login/route'

const request = (path: string, body: Row | string, headers: Record<string, string> = {}) => new NextRequest(
  'http://localhost:3000/api/auth/' + path,
  { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) },
)
const codeRow = (id: string, purpose: string, created: string): Row => ({
  id, user_id: 'user-1', purpose, code_hash: id, created_at: created,
  expires_at: '2099-01-01T00:00:00Z', attempts: 0, used_at: null,
})
async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 100 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 1))
  expect(predicate()).toBe(true)
}
beforeEach(() => {
  state.user = { id: 'user-1', email: 'test@example.com', role: 'student', password_hash: null,
    email_verified_at: '2026-10-04T01:00:00Z', auth_credential_version: 1 }
  state.codes = []; state.passwordWrites = []; state.sessions = []
  state.hashBarrier = null; state.hashCount = 0; state.verifyBarrier = null; state.verifyCount = 0; state.token = 0
  vi.clearAllMocks()
})

for (const [purpose, verify] of [['signup', verifySignup], ['reset_password', verifyReset]] as const) {
  it(purpose + ': consumed newest issuance never exposes the older code', async () => {
    if (purpose === 'reset_password') state.user.password_hash = 'existing'
    state.codes = [codeRow('C1111', purpose, '2026-10-04T01:00:00Z'), codeRow('C2222', purpose, '2026-10-04T02:00:00Z')]
    expect((await verify(request('verify', { email: 'test@example.com', code: 'C2222' }))).status).toBe(200)
    const response = await verify(request('verify', { email: 'test@example.com', code: 'C1111' }))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Invalid email or code' })
    expect(state.codes[0].used_at).toBeNull()
  })
  it(purpose + ': expired newest issuance never exposes the older code', async () => {
    if (purpose === 'reset_password') state.user.password_hash = 'existing'
    state.codes = [codeRow('C1111', purpose, '2026-10-04T01:00:00Z'), { ...codeRow('C2222', purpose, '2026-10-04T02:00:00Z'), expires_at: '2000-01-01T00:00:00Z' }]
    expect((await verify(request('verify', { email: 'test@example.com', code: 'C1111' }))).status).toBe(401)
  })
  it(purpose + ': a resend completed during bcrypt invalidates the pending older comparison', async () => {
    if (purpose === 'reset_password') state.user.password_hash = 'existing'
    state.codes = [codeRow('C1111', purpose, '2026-10-04T01:00:00Z')]
    let release!: () => void
    state.verifyBarrier = new Promise<void>(resolve => { release = resolve })
    const pending = verify(request('verify', { email: 'test@example.com', code: 'C1111' }))
    await waitFor(() => state.verifyCount === 1)
    state.codes.push(codeRow('C2222', purpose, '2026-10-04T02:00:00Z'))
    release()
    expect((await pending).status).toBe(401)
    expect(state.codes[0].used_at).toBeNull()
  })
}
it('two sibling signup handoffs permit exactly one initial password and session', async () => {
  const tokens = ['h'.repeat(35) + '1', 'h'.repeat(35) + '2']
  state.codes = tokens.map((token, i) => ({ id: 'handoff-' + i, user_id: 'user-1', purpose: 'signup',
    handoff_token_hash: token, handoff_consumed_at: null, handoff_expires_at: '2099-01-01T00:00:00Z' }))
  let release!: () => void
  state.hashBarrier = new Promise<void>(resolve => { release = resolve })
  const pending = tokens.map((token, i) => createPassword(request('create-password', {
    email: 'test@example.com', password: 'Password' + i, passwordConfirmation: 'Password' + i, handoffToken: token,
  })))
  await waitFor(() => state.hashCount === 2)
  release()
  expect((await Promise.all(pending)).map(response => response.status).sort()).toEqual([200, 401])
  expect(state.passwordWrites).toHaveLength(1)
  expect(state.sessions).toHaveLength(1)
  expect(state.user.password_hash).toBe(state.passwordWrites[0])
  expect(state.sessions[0][3]).toEqual({ expectedCredentialVersion: 1 })
})
it('credential epoch changing during password hashing prevents the stale signup write/session', async () => {
  const token = 'h'.repeat(36)
  state.codes = [{ user_id: 'user-1', purpose: 'signup', handoff_token_hash: token,
    handoff_consumed_at: null, handoff_expires_at: '2099-01-01T00:00:00Z' }]
  let release!: () => void
  state.hashBarrier = new Promise<void>(resolve => { release = resolve })
  const pending = createPassword(request('create-password', {
    email: 'test@example.com', password: 'Password123', passwordConfirmation: 'Password123', handoffToken: token,
  }))
  await waitFor(() => state.hashCount === 1)
  state.user.auth_credential_version = 2
  release()
  expect((await pending).status).toBe(401)
  expect(state.passwordWrites).toHaveLength(0)
  expect(state.sessions).toHaveLength(0)
})
it('rejects the actual foreign-Origin text/plain login form before credential or session work', async () => {
  state.user.password_hash = 'hash_Password123'
  const response = await login(request('login', '{"email":"test@example.com","password":"Password123","padding":"="}\r\n', {
    'content-type': 'text/plain', origin: 'https://other.example', 'sec-fetch-site': 'cross-site',
  }))
  expect(response.status).toBe(403)
  expect(state.sessions).toHaveLength(0)
})
for (const headers of [
  { origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' },
  { origin: 'null', 'sec-fetch-site': 'same-origin' },
  {}, // pika CLI and E2E/headless clients send explicit JSON without Origin/Fetch Metadata.
]) it('accepts legitimate JSON login headers ' + JSON.stringify(headers), async () => {
  state.user.password_hash = 'hash_Password123'
  expect((await login(request('login', { email: 'test@example.com', password: 'Password123' }, headers))).status).toBe(200)
  expect(state.sessions).toHaveLength(1)
})
for (const headers of [
  { origin: 'https://other.example' }, { 'sec-fetch-site': 'cross-site' }, { origin: 'null' },
]) it('rejects untrusted browser JSON login ' + JSON.stringify(headers), async () => {
  state.user.password_hash = 'hash_Password123'
  expect((await login(request('login', { email: 'test@example.com', password: 'Password123' }, headers))).status).toBe(403)
  expect(state.sessions).toHaveLength(0)
})
it('rejects a same-origin simple form content type', async () => {
  expect((await login(request('login', { email: 'test@example.com', password: 'Password123' },
    { origin: 'http://localhost:3000', 'content-type': 'text/plain' }))).status).toBe(415)
})
