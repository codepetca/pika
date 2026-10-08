import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requireAuth } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { GET } from '@/app/api/classrooms/home/route'
import type { AuthenticatedUser } from '@/types'

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  requireAuth: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))

const actorId = '11111111-1111-4111-8111-111111111111'
const otherOwnerId = '22222222-2222-4222-8222-222222222222'
const ownedId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const joinedId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const duplicateEnrollmentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const ownedClassroom = {
  id: ownedId,
  teacher_id: actorId,
  title: 'Owned math',
  class_code: 'OWN123',
  theme_color: 'teal',
  term_label: 'Fall',
  start_date: '2026-09-01',
  end_date: '2027-01-31',
  updated_at: '2026-09-18T12:00:00Z',
  archived_at: null,
  position: 1,
  private_field: 'must not cross the API boundary',
}
const joinedClassroom = {
  id: joinedId,
  teacher_id: otherOwnerId,
  title: 'Joined science',
  class_code: 'JOIN12',
  theme_color: 'rose',
  term_label: null,
  start_date: null,
  end_date: null,
  updated_at: '2026-09-17T12:00:00Z',
  archived_at: null,
  private_field: 'must not cross the API boundary',
}

type JoinedResult = { data: unknown; error: unknown }
let ownedResult: JoinedResult
let joinedResult: JoinedResult
let ownedQuery: ReturnType<typeof query>
let joinedQuery: ReturnType<typeof query>

function query(result: () => JoinedResult) {
  const filters: unknown[][] = []
  const builder = {
    filters,
    select: vi.fn(() => builder),
    eq: vi.fn((column: string, value: unknown) => { filters.push(['eq', column, value]); return builder }),
    is: vi.fn((column: string, value: unknown) => { filters.push(['is', column, value]); return builder }),
    order: vi.fn((column: string, value: unknown) => { filters.push(['order', column, value]); return builder }),
    then: (resolve: (value: JoinedResult) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject),
  }
  return builder
}

function enrollment(
  classroom = joinedClassroom,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: duplicateEnrollmentId,
    student_id: actorId,
    classroom_id: classroom.id,
    created_at: '2026-09-10T12:00:00Z',
    classrooms: classroom,
    ...overrides,
  }
}

describe('contextual classroom home backend pilot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_HOME_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_HOME_ACCESS_USER_IDS', JSON.stringify([actorId]))
    vi.mocked(requireAuth).mockResolvedValue({
      id: actorId,
      email: 'private@example.com',
      role: 'student',
    } as AuthenticatedUser)
    ownedResult = { data: [ownedClassroom], error: null }
    joinedResult = { data: [enrollment()], error: null }
    ownedQuery = query(() => ownedResult)
    joinedQuery = query(() => joinedResult)
    vi.mocked(getServiceRoleClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'classrooms') return ownedQuery
        if (table === 'classroom_enrollments') return joinedQuery
        throw new Error(`Unexpected table: ${table}`)
      }),
    } as never)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('authenticates before evaluating rollout state or querying relationships', async () => {
    vi.mocked(requireAuth).mockRejectedValue(Object.assign(new Error('no session'), {
      name: 'AuthenticationError',
    }))
    vi.stubEnv('PIKA_CLASSROOM_HOME_ACCESS_ENABLED', 'false')

    const response = await GET()

    expect(response.status).toBe(401)
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })

  it.each(['false', '', 'TRUE', '1'])('keeps the new endpoint unavailable with flag %j', async (flag) => {
    vi.stubEnv('PIKA_CLASSROOM_HOME_ACCESS_ENABLED', flag)

    const response = await GET()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found' })
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })

  it.each([
    '',
    'not-json',
    '{}',
    JSON.stringify([actorId, 3]),
    JSON.stringify(Array(101).fill(actorId)),
    ' '.repeat(20_001),
  ])('fails closed on invalid enabled cohort configuration', async (cohort) => {
    vi.stubEnv('PIKA_CLASSROOM_HOME_ACCESS_USER_IDS', cohort)

    const response = await GET()

    expect(response.status).toBe(503)
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })

  it('does not expose the endpoint to an authenticated non-cohort account', async () => {
    vi.stubEnv('PIKA_CLASSROOM_HOME_ACCESS_USER_IDS', '[]')

    const response = await GET()

    expect(response.status).toBe(404)
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })

  it.each(['student', 'teacher'] as const)(
    'returns owned and joined relationships without consulting the global %s role',
    async (role) => {
      vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role } as AuthenticatedUser)

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual({
        owned: [{
          id: ownedId,
          title: 'Owned math',
          class_code: 'OWN123',
          theme_color: 'teal',
          term_label: 'Fall',
          start_date: '2026-09-01',
          end_date: '2027-01-31',
          updated_at: '2026-09-18T12:00:00Z',
          relationship: 'owner',
          position: 1,
        }],
        joined: [{
          id: joinedId,
          title: 'Joined science',
          class_code: 'JOIN12',
          theme_color: 'rose',
          term_label: null,
          start_date: null,
          end_date: null,
          updated_at: '2026-09-17T12:00:00Z',
          relationship: 'member',
          enrollment_id: duplicateEnrollmentId,
          enrolled_at: '2026-09-10T12:00:00Z',
        }],
      })
      expect(JSON.stringify(body)).not.toContain('private_field')
      expect(JSON.stringify(body)).not.toContain('teacher_id')
      expect(JSON.stringify(body)).not.toContain('student_id')
      expect(ownedQuery.filters).toEqual([
        ['eq', 'teacher_id', actorId],
        ['is', 'archived_at', null],
        ['order', 'position', { ascending: true }],
        ['order', 'updated_at', { ascending: false }],
      ])
      expect(joinedQuery.filters).toEqual([
        ['eq', 'student_id', actorId],
        ['is', 'classrooms.archived_at', null],
        ['order', 'created_at', { ascending: false }],
      ])
    },
  )

  it('gives ownership precedence and deduplicates repeated enrollment evidence', async () => {
    joinedResult.data = [
      enrollment({ ...ownedClassroom }, { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }),
      enrollment(),
      enrollment(joinedClassroom, { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }),
    ]

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.owned).toHaveLength(1)
    expect(body.joined).toHaveLength(1)
    expect(body.joined[0].id).toBe(joinedId)
  })

  it.each(['owned', 'joined'])('returns no partial home when the %s relationship read fails', async (source) => {
    if (source === 'owned') {
      ownedResult = { data: null, error: { code: '08006' } }
    } else {
      joinedResult = { data: null, error: { code: '08006' } }
    }

    const response = await GET()

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Unable to load classroom home' })
  })

  it.each(['owned', 'joined'])('rejects null %s data without an explicit source error', async (source) => {
    if (source === 'owned') ownedResult = { data: null, error: null }
    else joinedResult = { data: null, error: null }

    const response = await GET()

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Unable to verify classroom home' })
  })

  it.each([
    ['substituted owner', [{ ...ownedClassroom, teacher_id: otherOwnerId }], [enrollment()]],
    ['wrong enrollment subject', [ownedClassroom], [enrollment(joinedClassroom, { student_id: otherOwnerId })]],
    ['substituted enrollment classroom', [ownedClassroom], [enrollment(joinedClassroom, { classroom_id: ownedId })]],
    ['archived joined class', [ownedClassroom], [enrollment({ ...joinedClassroom, archived_at: '2026-09-01T00:00:00Z' })]],
    ['malformed joined relation', [ownedClassroom], [enrollment(joinedClassroom, { classrooms: null })]],
  ])('rejects %s evidence instead of disclosing it', async (_case, owned, joined) => {
    ownedResult.data = owned
    joinedResult.data = joined

    const response = await GET()

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Unable to verify classroom home' })
  })

  it('canonicalizes configured UUID casing but rejects a malformed authenticated identity', async () => {
    vi.stubEnv('PIKA_CLASSROOM_HOME_ACCESS_USER_IDS', JSON.stringify([actorId.toUpperCase()]))
    expect((await GET()).status).toBe(200)

    vi.mocked(requireAuth).mockResolvedValue({ id: 'invalid', role: 'teacher' } as AuthenticatedUser)
    const response = await GET()
    expect(response.status).toBe(503)
    expect(getServiceRoleClient).toHaveBeenCalledTimes(1)
  })
})
