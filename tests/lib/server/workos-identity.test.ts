import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api-error'
import {
  findLinkedPikaUserFromWorkOS,
  resolvePikaUserFromWorkOS,
  type WorkOSIdentityStore,
} from '@/lib/server/workos-identity'

type Stored = Awaited<ReturnType<WorkOSIdentityStore['findByEmail']>>

function user(overrides: Partial<{ id: string; email: string; emailVerified: boolean }> = {}) {
  return {
    id: 'user_workos_1',
    email: 'student@example.com',
    emailVerified: true,
    ...overrides,
  }
}

describe('findLinkedPikaUserFromWorkOS', () => {
  it('returns only an existing exact subject and email link', async () => {
    const identityStore = store({
      findByWorkOSUserId: vi.fn(async () => stored()),
    })

    await expect(findLinkedPikaUserFromWorkOS(user(), identityStore)).resolves.toEqual({
      id: 'pika-user-1',
      email: 'student@example.com',
      role: 'student',
      workosUserId: 'user_workos_1',
    })
    expect(identityStore.findByEmail).not.toHaveBeenCalled()
    expect(identityStore.createUser).not.toHaveBeenCalled()
  })

  it('fails closed without mutating when the link is missing or mismatched', async () => {
    const identityStore = store({
      findByWorkOSUserId: vi.fn(async () => stored({ email: 'other@example.com' })),
    })

    await expect(findLinkedPikaUserFromWorkOS(user(), identityStore)).resolves.toBeNull()
    expect(identityStore.claimExistingUser).not.toHaveBeenCalled()
    expect(identityStore.createUser).not.toHaveBeenCalled()
  })
})

function store(overrides: Partial<WorkOSIdentityStore> = {}): WorkOSIdentityStore {
  return {
    findByWorkOSUserId: vi.fn(async () => null),
    findByEmail: vi.fn(async () => null),
    claimExistingUser: vi.fn(async () => null),
    createUser: vi.fn(async () => null),
    ...overrides,
  }
}

function stored(overrides: Partial<NonNullable<Stored>> = {}): NonNullable<Stored> {
  return {
    id: 'pika-user-1',
    email: 'student@example.com',
    role: 'student',
    workos_user_id: 'user_workos_1',
    ...overrides,
  }
}

describe('resolvePikaUserFromWorkOS', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('reuses the Pika UUID already linked to the WorkOS user', async () => {
    const identityStore = store({
      findByWorkOSUserId: vi.fn(async () => stored()),
    })

    await expect(resolvePikaUserFromWorkOS(user(), identityStore)).resolves.toEqual({
      id: 'pika-user-1',
      email: 'student@example.com',
      role: 'student',
      workosUserId: 'user_workos_1',
    })
    expect(identityStore.findByEmail).not.toHaveBeenCalled()
  })

  it('claims an existing email account without replacing its Pika UUID', async () => {
    const legacy = stored({ workos_user_id: null })
    const linked = stored()
    const identityStore = store({
      findByEmail: vi.fn(async () => legacy),
      claimExistingUser: vi.fn(async () => linked),
    })

    const result = await resolvePikaUserFromWorkOS(user(), identityStore)

    expect(result.id).toBe('pika-user-1')
    expect(identityStore.claimExistingUser).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'pika-user-1',
      workosUserId: 'user_workos_1',
    }))
  })

  it('creates a local student only after WorkOS verifies the email', async () => {
    const identityStore = store({
      createUser: vi.fn(async input => stored({
        email: input.email,
        role: input.role,
        workos_user_id: input.workosUserId,
      })),
    })

    await resolvePikaUserFromWorkOS(user({ email: ' Student@Example.com ' }), identityStore)

    expect(identityStore.createUser).toHaveBeenCalledWith(expect.objectContaining({
      email: 'student@example.com',
      role: 'student',
      workosUserId: 'user_workos_1',
    }))
  })

  it('uses Pika role derivation rather than a WorkOS role', async () => {
    vi.stubEnv('DEV_TEACHER_EMAILS', 'teacher@example.com')
    const identityStore = store({
      createUser: vi.fn(async input => stored({
        email: input.email,
        role: input.role,
        workos_user_id: input.workosUserId,
      })),
    })

    const result = await resolvePikaUserFromWorkOS(
      user({ email: 'teacher@example.com' }),
      identityStore,
    )

    expect(result.role).toBe('teacher')
  })

  it('fails closed for an unverified WorkOS email', async () => {
    const identityStore = store()

    await expect(resolvePikaUserFromWorkOS(
      user({ emailVerified: false }),
      identityStore,
    )).rejects.toMatchObject<ApiError>({ statusCode: 401 })
    expect(identityStore.findByWorkOSUserId).not.toHaveBeenCalled()
  })

  it('fails closed when an email is linked to another WorkOS user', async () => {
    const identityStore = store({
      findByEmail: vi.fn(async () => stored({ workos_user_id: 'user_workos_other' })),
    })

    await expect(resolvePikaUserFromWorkOS(user(), identityStore))
      .rejects.toMatchObject<ApiError>({ statusCode: 409 })
    expect(identityStore.claimExistingUser).not.toHaveBeenCalled()
  })

  it('recovers an idempotent unique race only when both lookups resolve to one user', async () => {
    const linked = stored()
    const findByWorkOSUserId = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(linked)
    const findByEmail = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(linked)
    const identityStore = store({
      findByWorkOSUserId,
      findByEmail,
      createUser: vi.fn(async () => null),
    })

    await expect(resolvePikaUserFromWorkOS(user(), identityStore)).resolves.toMatchObject({
      id: 'pika-user-1',
      workosUserId: 'user_workos_1',
    })
  })
})
