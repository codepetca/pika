import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const USER_ID = '10000000-0000-4000-8000-000000000001'
const CODE_ID = '20000000-0000-4000-8000-000000000001'
const HANDOFF_HASH = 'a'.repeat(64)
interface CodeState {
  id: string
  generation: number
  code_hash: string
  attempts: number
  used_at: string | null
  expires_at: string
  handoff_token_hash?: string | null
  handoff_expires_at?: string | null
  handoff_consumed_at?: string | null
}
const state = vi.hoisted(() => ({
  user: {} as Record<string, unknown>,
  code: null as CodeState | null,
  verifyBarrier: null as Promise<void> | null,
  verifyCount: 0,
  hashBarrier: null as Promise<void> | null,
  hashCount: 0,
  passwordWrites: [] as string[],
  sessions: [] as unknown[][],
}))

vi.mock('@/lib/auth', () => ({ createSession: vi.fn(async (...args: unknown[]) => { state.sessions.push(args) }) }))
vi.mock('@/lib/server/auth-rate-limit', () => ({ consumeAuthRequestRateLimits: vi.fn(async () => {}) }))
vi.mock('@/lib/crypto', () => ({
  verifyCode: vi.fn(async (code: string, hash: string) => {
    state.verifyCount++
    if (state.verifyBarrier) await state.verifyBarrier
    return code === hash
  }),
  generateHandoffToken: () => 'handoff-token-abcdefghijklmnopqrstuvwxyz1234567890',
  hashHandoffToken: () => HANDOFF_HASH,
  hashPassword: vi.fn(async (password: string) => {
    state.hashCount++
    if (state.hashBarrier) await state.hashBarrier
    return `hash_${password}`
  }),
  verifyPassword: vi.fn(async (password: string, hash: string) => hash === `hash_${password}`),
}))

const supabase = {
  from: vi.fn(() => ({
    select: () => ({ eq: () => ({ single: async () => ({ data: { ...state.user }, error: null }) }) }),
  })),
  rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'get_latest_auth_verification_code_v1') {
      return { data: state.code ? { ...state.code } : null, error: null }
    }
    if (name === 'finalize_auth_verification_attempt_v1') {
      const current = state.code
      const usable = Boolean(current
        && current.id === args.p_candidate_id
        && current.generation === args.p_candidate_generation
        && current.used_at === null
        && Date.parse(current.expires_at) > Date.now()
        && current.attempts < Number(args.p_max_attempts))
      if (!usable) return { data: { ok: false }, error: null }
      if (!args.p_code_matched) {
        current!.attempts++
        return { data: { ok: false }, error: null }
      }
      current!.used_at = new Date().toISOString()
      current!.handoff_token_hash = String(args.p_handoff_token_hash)
      current!.handoff_expires_at = String(args.p_handoff_expires_at)
      current!.handoff_consumed_at = null
      if (args.p_purpose === 'signup') state.user.email_verified_at = new Date().toISOString()
      return { data: { ok: true, user_id: USER_ID, generation: current!.generation }, error: null }
    }
    if (name === 'inspect_latest_auth_handoff_v1') {
      const current = state.code
      const valid = current?.handoff_token_hash === args.p_handoff_token_hash
        && current.handoff_consumed_at === null
        && Date.parse(current.handoff_expires_at || '') > Date.now()
      return { data: valid ? {
        user_id: USER_ID, email: state.user.email, role: state.user.role,
        generation: current!.generation, credential_version: state.user.auth_credential_version,
        email_verified: Boolean(state.user.email_verified_at), password_set: Boolean(state.user.password_hash),
      } : null, error: null }
    }
    if (name === 'consume_signup_password_handoff_v1') {
      const current = state.code
      const valid = current?.generation === args.p_generation
        && current.handoff_token_hash === args.p_handoff_token_hash
        && current.handoff_consumed_at === null
        && !state.user.password_hash
        && state.user.auth_credential_version === args.p_expected_credential_version
      if (!valid) return { data: null, error: null }
      current!.handoff_consumed_at = new Date().toISOString()
      state.user.password_hash = args.p_password_hash
      state.passwordWrites.push(String(args.p_password_hash))
      return { data: state.user.auth_credential_version, error: null }
    }
    if (name === 'consume_latest_password_reset_and_revoke_sessions_v1') {
      const current = state.code
      const valid = current?.generation === args.p_generation
        && current.handoff_token_hash === args.p_handoff_token_hash
        && current.handoff_consumed_at === null
      if (!valid) return { data: null, error: null }
      current!.handoff_consumed_at = new Date().toISOString()
      state.user.password_hash = args.p_password_hash
      state.user.auth_credential_version = Number(state.user.auth_credential_version) + 1
      state.passwordWrites.push(String(args.p_password_hash))
      return { data: state.user.auth_credential_version, error: null }
    }
    throw new Error(`unexpected RPC ${name}`)
  }),
}
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => supabase }))

import { POST as verifySignup } from '@/app/api/auth/verify-signup/route'
import { POST as verifyReset } from '@/app/api/auth/reset-password/verify/route'
import { POST as createPassword } from '@/app/api/auth/create-password/route'
import { POST as login } from '@/app/api/auth/login/route'

const request = (path: string, body: Record<string, unknown> | string, headers: Record<string, string> = {}) => new NextRequest(
  `http://localhost:3000/api/auth/${path}`,
  { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) },
)
const code = (generation = 1): CodeState => ({
  id: CODE_ID, generation, code_hash: 'ABC12', attempts: 0, used_at: null,
  expires_at: new Date(Date.now() + 60_000).toISOString(),
})
async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 100 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 1))
  expect(predicate()).toBe(true)
}

beforeEach(() => {
  state.user = { id: USER_ID, email: 'user@example.com', role: 'student', password_hash: null, email_verified_at: null, auth_credential_version: 1 }
  state.code = code(); state.verifyBarrier = null; state.verifyCount = 0; state.hashBarrier = null; state.hashCount = 0
  state.passwordWrites = []; state.sessions = []
  vi.clearAllMocks()
})

for (const [purpose, handler] of [['signup', verifySignup], ['reset_password', verifyReset]] as const) {
  it(`${purpose}: a resend during bcrypt invalidates the pending comparison`, async () => {
    if (purpose === 'reset_password') state.user.password_hash = 'existing'
    let release!: () => void
    state.verifyBarrier = new Promise(resolve => { release = resolve })
    const pending = handler(request(purpose === 'signup' ? 'verify-signup' : 'reset-password/verify', { email: 'user@example.com', code: 'ABC12' }))
    await waitFor(() => state.verifyCount === 1)
    state.code = code(2)
    release()
    expect((await pending).status).toBe(401)
    expect(state.code.used_at).toBeNull()
  })

  it(`${purpose}: expiry during bcrypt is rechecked atomically`, async () => {
    if (purpose === 'reset_password') state.user.password_hash = 'existing'
    let release!: () => void
    state.verifyBarrier = new Promise(resolve => { release = resolve })
    const pending = handler(request(purpose === 'signup' ? 'verify-signup' : 'reset-password/verify', { email: 'user@example.com', code: 'ABC12' }))
    await waitFor(() => state.verifyCount === 1)
    state.code!.expires_at = new Date(Date.now() - 1).toISOString()
    release()
    expect((await pending).status).toBe(401)
    expect(state.code!.used_at).toBeNull()
  })
}

it('a resend invalidates an already minted signup handoff before password hashing', async () => {
  expect((await verifySignup(request('verify-signup', { email: 'user@example.com', code: 'ABC12' }))).status).toBe(200)
  state.code = code(2)
  const response = await createPassword(request('create-password', {
    email: 'user@example.com', password: 'Password123', passwordConfirmation: 'Password123',
    handoffToken: 'handoff-token-abcdefghijklmnopqrstuvwxyz1234567890',
  }))
  expect(response.status).toBe(401)
  expect(state.hashCount).toBe(0)
})

it('two sibling confirmations create exactly one password and session', async () => {
  state.user.email_verified_at = new Date().toISOString()
  state.code = { ...code(), used_at: new Date().toISOString(), handoff_token_hash: HANDOFF_HASH,
    handoff_expires_at: new Date(Date.now() + 60_000).toISOString(), handoff_consumed_at: null }
  let release!: () => void
  state.hashBarrier = new Promise(resolve => { release = resolve })
  const calls = [1, 2].map(n => createPassword(request('create-password', {
    email: 'user@example.com', password: `Password12${n}`, passwordConfirmation: `Password12${n}`,
    handoffToken: 'handoff-token-abcdefghijklmnopqrstuvwxyz1234567890',
  })))
  await waitFor(() => state.hashCount === 2)
  release()
  expect((await Promise.all(calls)).map(response => response.status).sort()).toEqual([200, 401])
  expect(state.passwordWrites).toHaveLength(1)
  expect(state.sessions).toHaveLength(1)
})

it('rejects a foreign-origin simple-form login before credential work', async () => {
  state.user.password_hash = 'hash_Password123'
  const response = await login(request('login', '{"email":"user@example.com","password":"Password123"}', {
    'content-type': 'text/plain', origin: 'https://other.example', 'sec-fetch-site': 'cross-site',
  }))
  expect(response.status).toBe(403)
  expect(state.sessions).toHaveLength(0)
})
