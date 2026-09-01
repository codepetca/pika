import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IronSession } from 'iron-session'
import type { SessionData, UserRole } from '@/types'

const workOSMocks = vi.hoisted(() => ({ withAuth: vi.fn() }))
const palMocks = vi.hoisted(() => ({ recordPalAuthenticatedSession: vi.fn() }))
const databaseMocks = vi.hoisted(() => ({
  deleteEq: vi.fn(),
  deleteLte: vi.fn(),
  insert: vi.fn(),
  maybeSingle: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@workos-inc/authkit-nextjs', () => ({ withAuth: workOSMocks.withAuth }))
vi.mock('@/lib/server/pal-signals', () => ({
  recordPalAuthenticatedSession: palMocks.recordPalAuthenticatedSession,
}))
vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => ({ from: databaseMocks.from })),
}))

const mockSession: Partial<IronSession<SessionData>> = {
  auth: undefined,
  save: vi.fn(),
  destroy: vi.fn(),
}

vi.mock('iron-session', () => ({
  getIronSession: vi.fn(() => Promise.resolve(mockSession)),
}))
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => Promise.resolve(new Map())),
}))

import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import {
  AuthenticationError,
  AuthorizationError,
  createSession,
  destroySession,
  getCurrentUser,
  getSession,
  isTeacherEmail,
  requireAuth,
  requireRole,
  requireSnapshotGalleryAccess,
} from '@/lib/auth'

function resolvedRow(args: {
  id?: string
  email?: string
  role?: UserRole | string
  authSource?: 'password' | 'workos'
  workosUserId?: string | null
} = {}) {
  const id = args.id || 'user-1'
  const workosUserId = args.workosUserId ?? null
  return {
    user_id: id,
    auth_source: args.authSource || 'password',
    workos_user_id: workosUserId,
    expires_at: '2027-01-01T00:00:00.000Z',
    users: {
      id,
      email: args.email || 'student@example.com',
      role: args.role || 'student',
      workos_user_id: workosUserId,
    },
  }
}

function useSealedSession(row = resolvedRow()) {
  mockSession.auth = { token: 'opaque-session-token', version: 3 }
  databaseMocks.maybeSingle.mockResolvedValue({ data: row, error: null })
}

describe('auth utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('WORKOS_MAGIC_AUTH_PILOT', 'false')
    workOSMocks.withAuth.mockResolvedValue({ user: null })
    mockSession.auth = undefined
    databaseMocks.deleteEq.mockResolvedValue({ error: null })
    databaseMocks.deleteLte.mockResolvedValue({ error: null })
    databaseMocks.insert.mockResolvedValue({ error: null })
    databaseMocks.maybeSingle.mockResolvedValue({ data: null, error: null })
    databaseMocks.from.mockImplementation((table: string) => {
      expect(table).toBe('auth_sessions')
      return {
        delete: vi.fn(() => ({
          eq: databaseMocks.deleteEq,
          lte: databaseMocks.deleteLte,
        })),
        insert: databaseMocks.insert,
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            gt: vi.fn(() => ({ maybeSingle: databaseMocks.maybeSingle })),
          })),
        })),
      }
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('uses a secure HttpOnly same-site cookie whose seal matches its 180-day lifetime', async () => {
    await getSession()
    expect(cookies).toHaveBeenCalledOnce()
    expect(getIronSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        cookieName: 'pika_session',
        ttl: 180 * 24 * 60 * 60 + 60,
        cookieOptions: expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          maxAge: 180 * 24 * 60 * 60,
        }),
      }),
    )
  })

  it('persists only a hash server-side and only an opaque token in the sealed cookie', async () => {
    await createSession('user-1', 'student@example.com', 'student')

    expect(databaseMocks.deleteLte).toHaveBeenCalledWith(
      'expires_at',
      expect.any(String),
    )
    expect(mockSession.auth).toEqual({
      token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      version: 3,
    })
    expect(mockSession.auth).not.toHaveProperty('email')
    expect(databaseMocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-1',
      token_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      auth_source: 'password',
      workos_user_id: null,
      expires_at: expect.any(String),
    }))
    expect(databaseMocks.insert.mock.calls[0][0].token_hash).not.toBe(mockSession.auth?.token)
    expect(mockSession.save).toHaveBeenCalledOnce()
  })

  it('binds WorkOS sessions server-side and can suppress restoration telemetry', async () => {
    await createSession('user-1', 'student@example.com', 'student', {
      workosUserId: 'user_workos_1',
      recordAuthenticationEvent: false,
    })

    expect(databaseMocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      auth_source: 'workos',
      workos_user_id: 'user_workos_1',
    }))
    expect(palMocks.recordPalAuthenticatedSession).not.toHaveBeenCalled()
  })

  it('rotates the current server-side session before issuing a new one', async () => {
    mockSession.auth = { token: 'previous-token', version: 3 }
    await createSession('teacher-1', 'teacher@yrdsb.ca', 'teacher')

    expect(databaseMocks.deleteEq).toHaveBeenCalledWith(
      'token_hash',
      expect.stringMatching(/^[0-9a-f]{64}$/),
    )
    expect(databaseMocks.insert).toHaveBeenCalledOnce()
  })

  it('revokes the current server-side session during logout', async () => {
    mockSession.auth = { token: 'current-token', version: 3 }
    await destroySession()

    expect(databaseMocks.deleteEq).toHaveBeenCalledOnce()
    expect(mockSession.destroy).toHaveBeenCalledOnce()
  })

  it('still destroys the browser cookie when server-side revocation fails', async () => {
    mockSession.auth = { token: 'current-token', version: 3 }
    databaseMocks.deleteEq.mockResolvedValue({ error: { message: 'unavailable' } })

    await expect(destroySession()).rejects.toThrow('Failed to revoke authentication session')
    expect(mockSession.destroy).toHaveBeenCalledOnce()
  })

  it('rejects legacy seals, missing rows, and database failures', async () => {
    await expect(getCurrentUser()).resolves.toBeNull()

    mockSession.auth = { token: 'current-token', version: 3 }
    await expect(getCurrentUser()).resolves.toBeNull()

    databaseMocks.maybeSingle.mockResolvedValue({ data: null, error: { message: 'unavailable' } })
    await expect(getCurrentUser()).resolves.toBeNull()
  })

  it('returns current database identity and role rather than cookie-carried PII', async () => {
    useSealedSession(resolvedRow({
      id: 'teacher-1',
      email: 'current-teacher@yrdsb.ca',
      role: 'teacher',
    }))

    await expect(getCurrentUser()).resolves.toEqual({
      id: 'teacher-1',
      email: 'current-teacher@yrdsb.ca',
      role: 'teacher',
      authSource: 'password',
    })
  })

  it('rejects invalid current roles and mismatched linked users', async () => {
    useSealedSession(resolvedRow({ role: 'admin' }))
    await expect(getCurrentUser()).resolves.toBeNull()

    const row = resolvedRow()
    row.user_id = 'different-user'
    useSealedSession(row)
    await expect(getCurrentUser()).resolves.toBeNull()
  })

  it('requires an exact verified WorkOS subject, mapping, and normalized email', async () => {
    vi.stubEnv('WORKOS_MAGIC_AUTH_PILOT', 'true')
    useSealedSession(resolvedRow({
      email: ' Student@Example.com ',
      authSource: 'workos',
      workosUserId: 'user_workos_1',
    }))
    workOSMocks.withAuth.mockResolvedValue({
      user: { id: 'user_workos_1', email: 'student@example.com', emailVerified: true },
    })
    await expect(getCurrentUser()).resolves.toEqual(expect.objectContaining({
      authSource: 'workos',
      workosUserId: 'user_workos_1',
    }))

    workOSMocks.withAuth.mockResolvedValue({
      user: { id: 'different', email: 'student@example.com', emailVerified: true },
    })
    await expect(getCurrentUser()).resolves.toBeNull()
  })

  it('rejects WorkOS mappings when the pilot is disabled and password sessions when enabled', async () => {
    useSealedSession(resolvedRow({ authSource: 'workos', workosUserId: 'user_workos_1' }))
    await expect(getCurrentUser()).resolves.toBeNull()

    vi.stubEnv('WORKOS_MAGIC_AUTH_PILOT', 'true')
    useSealedSession(resolvedRow())
    workOSMocks.withAuth.mockResolvedValue({
      user: { id: 'user_workos_1', email: 'student@example.com', emailVerified: true },
    })
    await expect(getCurrentUser()).resolves.toBeNull()
  })

  it('enforces authentication and role authorization from the resolved database user', async () => {
    await expect(requireAuth()).rejects.toThrow(AuthenticationError)

    useSealedSession(resolvedRow({ role: 'student' }))
    await expect(requireRole('student')).resolves.toEqual(expect.objectContaining({ role: 'student' }))
    await expect(requireRole('teacher')).rejects.toThrow(AuthorizationError)
    await expect(requireRole('teacher')).rejects.toThrow(/teacher role required/)
  })

  it('keeps the snapshot gallery teacher-only and disabled in production', async () => {
    useSealedSession(resolvedRow({ role: 'teacher', email: 'teacher@yrdsb.ca' }))
    vi.stubEnv('NODE_ENV', 'development')
    await expect(requireSnapshotGalleryAccess()).resolves.toEqual(
      expect.objectContaining({ role: 'teacher' }),
    )

    vi.stubEnv('NODE_ENV', 'production')
    await expect(requireSnapshotGalleryAccess()).rejects.toThrow(AuthorizationError)
  })

  describe('isTeacherEmail', () => {
    it.each([
      'teacher@yrdsb.ca',
      'john.smith@gapps.yrdsb.ca',
      'john123@gapps.yrdsb.ca',
    ])('classifies alphabetic YRDSB identity %s as teacher', (email) => {
      expect(isTeacherEmail(email)).toBe(true)
    })

    it.each([
      '123456789@yrdsb.ca',
      '123456789@gapps.yrdsb.ca',
      '000000001@gapps.yrdsb.ca',
      'user@gmail.com',
      'teacher@fakegapps.yrdsb.ca.evil.com',
      'notanemail',
    ])('does not elevate student or invalid identity %s', (email) => {
      expect(isTeacherEmail(email)).toBe(false)
    })

    it('normalizes case/whitespace and supports exact development teachers', () => {
      vi.stubEnv('DEV_TEACHER_EMAILS', ' dev@example.com ')
      expect(isTeacherEmail(' TEACHER@YRDSB.CA ')).toBe(true)
      expect(isTeacherEmail('DEV@example.com')).toBe(true)
      expect(isTeacherEmail('other@example.com')).toBe(false)
    })
  })
})
