import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { requireAuth, requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { GET as ownerGet, PATCH } from '@/app/api/teacher/classrooms/[id]/route'
import { GET as memberGet } from '@/app/api/student/classrooms/[id]/route'
import { GET as calendarGet } from '@/app/api/classrooms/[classroomId]/class-days/route'
import { GET as legacyCalendarGet } from '@/app/api/teacher/class-days/route'
import { GET as guideGet } from '@/app/api/classrooms/[classroomId]/course-guide/route'
import { fetchClassDaysForClassroom } from '@/lib/server/class-days'
import { getClassroomCourseGuide } from '@/lib/server/course-guide'
import type { AuthenticatedUser } from '@/types'

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth')>(), requireAuth: vi.fn(), requireRole: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/classroom-order', () => ({ getNextTeacherClassroomPosition: vi.fn(async () => -2) }))
vi.mock('@/lib/server/class-days', () => ({ fetchClassDaysForClassroom: vi.fn(), generateClassDaysForClassroom: vi.fn(), upsertClassDayForClassroom: vi.fn() }))
vi.mock('@/lib/server/course-guide', () => ({ getClassroomCourseGuide: vi.fn() }))

const actorId = '11111111-1111-4111-8111-111111111111'
const otherOwner = '22222222-2222-4222-8222-222222222222'
const ownId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const joinedId = '44444444-4444-4444-8444-444444444444'
const archivedAt = '2026-09-01T00:00:00Z'
type Row = { id: string; teacher_id: string; archived_at: string | null; title: string; feature_visibility?: unknown; position?: number; course_overview_markdown?: string; course_outline_markdown?: string }
let rows: Row[]
let beforeWrite: (() => void) | undefined
let responseOverride: unknown
let writeError: unknown
let queries: unknown[][]

function request(id: string, body?: unknown) {
  return new NextRequest(`http://localhost/api/classrooms/${id}`, {
    method: body === undefined ? 'GET' : 'PATCH', ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
function params(id: string) { return { params: { id, classroomId: id } } }

// PostgreSQL accepts these equivalent UUID spellings, unlike strict string mocks.
function databaseUuid(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const hex = value.replace(/[{}-]/g, '').toLowerCase()
  return /^[0-9a-f]{32}$/.test(hex)
    ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    : value
}

describe('contextual classroom-core API pilot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_CORE_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_CORE_ACCESS_PAIRS', JSON.stringify([
      { userId: actorId, classroomId: ownId }, { userId: actorId, classroomId: joinedId },
    ]))
    vi.stubEnv('PIKA_ACCESS_SHADOW_ENABLED', 'false')
    const actor = { id: actorId, role: 'student', email: 'private@example.com' } as AuthenticatedUser
    vi.mocked(requireAuth).mockResolvedValue(actor)
    vi.mocked(requireRole).mockImplementation(async (role) => {
      const current = await requireAuth()
      if (role !== current.role) throw Object.assign(new Error('Forbidden'), { name: 'AuthorizationError' })
      return current
    })
    vi.mocked(fetchClassDaysForClassroom).mockResolvedValue({ classDays: [], error: null })
    vi.mocked(getClassroomCourseGuide).mockResolvedValue({ ok: true, guide: { title: 'Course guide' } } as Awaited<ReturnType<typeof getClassroomCourseGuide>>)
    rows = [
      { id: ownId, teacher_id: actorId, archived_at: null, title: 'Own class' },
      { id: joinedId, teacher_id: otherOwner, archived_at: null, title: 'Joined class' },
    ]
    beforeWrite = undefined; responseOverride = undefined; writeError = null; queries = []
    const from = vi.fn((table: string) => {
      const filters: [string, unknown][] = []
      let updates: Record<string, unknown> | undefined
      const execute = async () => {
        if (updates) beforeWrite?.()
        const classroom = rows.find((row) => filters.every(([key, value]) => {
          const actual = (row as unknown as Record<string, unknown>)[key]
          return key === 'id' || key.endsWith('_id') ? databaseUuid(actual) === databaseUuid(value) : actual === value
        }))
        if (table === 'classroom_enrollments') {
          const enrolled = filters.some(([key, value]) => key === 'classroom_id' && databaseUuid(value) === joinedId) &&
            filters.some(([key, value]) => key === 'student_id' && databaseUuid(value) === actorId)
          return { data: enrolled ? { id: actorId, classroom_id: joinedId, student_id: actorId } : null, error: null }
        }
        if (updates && writeError) return { data: null, error: writeError }
        if (updates && classroom) Object.assign(classroom, updates)
        return { data: updates && responseOverride !== undefined ? responseOverride : classroom ? structuredClone(classroom) : null, error: null }
      }
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn((key, value) => { filters.push([key, value]); queries.push([table, 'eq', key, value]); return builder }),
        is: vi.fn((key, value) => { filters.push([key, value]); queries.push([table, 'is', key, value]); return builder }),
        update: vi.fn((value) => { updates = value; queries.push([table, 'update', value]); return builder }),
        maybeSingle: vi.fn(execute), single: vi.fn(execute),
      }
      return builder
    })
    vi.mocked(getServiceRoleClient).mockReturnValue({ from } as unknown as ReturnType<typeof getServiceRoleClient>)
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

  it('requires authentication before querying any pilot classroom', async () => {
    vi.mocked(requireAuth).mockRejectedValue(Object.assign(new Error('Unauthorized'), { name: 'AuthenticationError' }))
    expect((await ownerGet(request(ownId), params(ownId))).status).toBe(401)
    expect((await memberGet(request(joinedId), params(joinedId))).status).toBe(401)
    expect((await PATCH(request(ownId, { title: 'No' }), params(ownId))).status).toBe(401)
    expect(queries).toEqual([])
  })

  it('lets one account own A and join B, but never manage B or participate as its own student', async () => {
    expect((await ownerGet(request(ownId), params(ownId))).status).toBe(200)
    expect((await memberGet(request(joinedId), params(joinedId))).status).toBe(200)
    expect((await ownerGet(request(joinedId), params(joinedId))).status).toBe(403)
    expect((await memberGet(request(ownId), params(ownId))).status).toBe(403)
    expect((await PATCH(request(joinedId, { title: 'Forged' }), params(joinedId))).status).toBe(403)
    expect(rows[1].title).toBe('Joined class')
  })

  it('also lets a teacher-valued account read a joined classroom', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role: 'teacher' } as AuthenticatedUser)
    expect((await memberGet(request(joinedId), params(joinedId))).status).toBe(200)
  })

  it('cannot bypass the pilot by changing UUID casing, including for writes', async () => {
    const uppercase = ownId.toUpperCase()
    expect((await memberGet(request(uppercase), params(uppercase))).status).toBe(403)
    expect((await PATCH(request(uppercase, { title: 'Updated' }), params(uppercase))).status).toBe(200)
    expect(rows[0].title).toBe('Updated')
  })

  it.each(['dashless', 'braced', 'alternate-hyphens'])('rejects %s UUID aliases before legacy fallback', async (format) => {
    const alias = (id: string) => format === 'dashless' ? id.replaceAll('-', '')
      : format === 'braced' ? `{${id}}` : id.replaceAll('-', '').match(/.{4}/g)!.join('-')
    rows[1].course_overview_markdown = 'Private draft'
    const response = await memberGet(request(alias(joinedId)), params(alias(joinedId)))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid classroom identifier' })
    expect((await memberGet(request(alias(ownId)), params(alias(ownId)))).status).toBe(400)
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role: 'teacher' } as AuthenticatedUser)
    expect((await PATCH(request(alias(ownId), { title: 'No' }), params(alias(ownId)))).status).toBe(400)
    expect(queries).toEqual([])
    expect(rows[0].title).toBe('Own class')

    // Prove the mock would resolve this spelling on the unchanged disabled path.
    vi.stubEnv('PIKA_CLASSROOM_CORE_ACCESS_ENABLED', 'false')
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role: 'student' } as AuthenticatedUser)
    const legacy = await memberGet(request(alias(joinedId)), params(alias(joinedId)))
    expect(legacy.status).toBe(200)
    expect((await legacy.json()).classroom.id).toBe(joinedId)
  })

  it.each(['empty', 'unmatched'])('preserves the legacy Forbidden response for an enabled %s cohort', async (cohort) => {
    vi.stubEnv('PIKA_CLASSROOM_CORE_ACCESS_PAIRS', JSON.stringify(cohort === 'empty' ? [] : [{ userId: otherOwner, classroomId: ownId }]))
    for (const response of [await ownerGet(request(ownId), params(ownId)), await PATCH(request(ownId, { title: 'No' }), params(ownId))]) {
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: 'Forbidden' })
    }
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role: 'teacher' } as AuthenticatedUser)
    const member = await memberGet(request(joinedId), params(joinedId))
    expect(member.status).toBe(403)
    expect(await member.json()).toEqual({ error: 'Forbidden' })
    expect(queries).toEqual([])
  })

  it.each([ownId, joinedId])('uses classroom relationships for shared reads of %s', async (id) => {
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role: id === joinedId ? 'teacher' : 'student' } as AuthenticatedUser)
    expect((await calendarGet(request(id), params(id))).status).toBe(200)
    expect((await legacyCalendarGet(new NextRequest(`http://localhost/api/teacher/class-days?classroom_id=${id}`))).status).toBe(200)
    expect((await guideGet(request(id), params(id))).status).toBe(200)
  })

  it('does not let a teacher-valued member bypass Course Guide visibility', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role: 'teacher' } as AuthenticatedUser)
    rows[1].feature_visibility = { syllabus: false }
    expect((await guideGet(request(joinedId), params(joinedId))).status).toBe(403)
    expect(getClassroomCourseGuide).not.toHaveBeenCalled()
    rows[0].feature_visibility = { syllabus: false }
    expect((await guideGet(request(ownId), params(ownId))).status).toBe(200)
  })

  it('does not expose raw guide drafts through member classroom details', async () => {
    rows[1].course_overview_markdown = 'Unpublished private overview'
    rows[1].course_outline_markdown = 'Private outline'
    const response = await memberGet(request(joinedId), params(joinedId))
    const result = await response.json()
    expect(result.classroom.course_overview_markdown).toBe('')
    expect(result.classroom.course_outline_markdown).toBe('')
    expect(rows[1].course_overview_markdown).toBe('Unpublished private overview')
    rows[0].course_overview_markdown = 'Owner draft'
    const owner = await ownerGet(request(ownId), params(ownId))
    expect((await owner.json()).classroom.course_overview_markdown).toBe('Owner draft')
  })

  it('keeps archived ownership, blocks ordinary edits and member reads, and permits owner-only restore', async () => {
    rows[0].archived_at = archivedAt; rows[1].archived_at = archivedAt
    expect((await ownerGet(request(ownId), params(ownId))).status).toBe(200)
    expect((await PATCH(request(ownId, { title: 'No' }), params(ownId))).status).toBe(403)
    expect((await memberGet(request(joinedId), params(joinedId))).status).toBe(403)
    expect((await PATCH(request(joinedId, { archived: false }), params(joinedId))).status).toBe(403)
    const response = await PATCH(request(ownId, { archived: false }), params(ownId))
    expect(response.status).toBe(200)
    expect(rows[0]).toMatchObject({ archived_at: null, position: -2 })
    expect(queries).toContainEqual(['classrooms', 'eq', 'archived_at', archivedAt])
  })

  it('binds ordinary updates to the authenticated owner and active state at write time', async () => {
    expect((await PATCH(request(ownId, { title: 'Updated', teacher_id: otherOwner, plan: 'pro' }), params(ownId))).status).toBe(200)
    expect(rows[0]).toMatchObject({ title: 'Updated', teacher_id: actorId })
    expect(queries).toContainEqual(['classrooms', 'eq', 'teacher_id', actorId])
    expect(queries).toContainEqual(['classrooms', 'is', 'archived_at', null])
  })

  it('retains explicit archive transitions and rejects mixed or duplicate toggles', async () => {
    expect((await PATCH(request(ownId, { archived: true, title: 'No' }), params(ownId))).status).toBe(400)
    expect(rows[0].archived_at).toBeNull()
    expect((await PATCH(request(ownId, { archived: false }), params(ownId))).status).toBe(400)
    expect((await PATCH(request(ownId, { archived: true }), params(ownId))).status).toBe(200)
    expect(rows[0].archived_at).toEqual(expect.any(String))
    expect((await PATCH(request(ownId, { archived: true }), params(ownId))).status).toBe(400)
    expect((await PATCH(request(ownId, { archived: false, title: 'No' }), params(ownId))).status).toBe(400)
    expect(rows[0].title).toBe('Own class')
  })

  it.each(['owner', 'archive', 'delete'])('rejects a concurrent %s change without writing stale-authorized data', async (change) => {
    beforeWrite = () => {
      if (change === 'owner') rows[0].teacher_id = otherOwner
      if (change === 'archive') rows[0].archived_at = archivedAt
      if (change === 'delete') rows.splice(0, 1)
    }
    const response = await PATCH(request(ownId, { title: 'Must not save' }), params(ownId))
    expect(response.status).toBe(409)
    expect(rows.every((row) => row.title !== 'Must not save')).toBe(true)
  })

  it('does not return substituted or malformed post-write records', async () => {
    responseOverride = { ...rows[1] }
    expect((await PATCH(request(ownId, { title: 'Update' }), params(ownId))).status).toBe(503)
    responseOverride = { id: ownId, teacher_id: actorId }
    expect((await PATCH(request(ownId, { title: 'Update' }), params(ownId))).status).toBe(503)
    responseOverride = { ...rows[0], teacher_id: otherOwner }
    expect((await PATCH(request(ownId, { title: 'Update' }), params(ownId))).status).toBe(503)
  })

  it('keeps real write errors distinct from a stale-state conflict', async () => {
    writeError = { code: '08006' }
    expect((await PATCH(request(ownId, { title: 'Update' }), params(ownId))).status).toBe(500)
  })

  it('does not grant access via client claims, unmatched pairs, or a disabled gate', async () => {
    vi.stubEnv('PIKA_CLASSROOM_CORE_ACCESS_PAIRS', JSON.stringify([{ userId: actorId, classroomId: joinedId }]))
    expect((await PATCH(request(ownId, { title: 'No', role: 'teacher', plan: 'pro' }), params(ownId))).status).toBe(403)
    expect(queries).toEqual([])
    vi.stubEnv('PIKA_CLASSROOM_CORE_ACCESS_ENABLED', 'false')
    expect((await ownerGet(request(ownId), params(ownId))).status).toBe(403)
  })
})
