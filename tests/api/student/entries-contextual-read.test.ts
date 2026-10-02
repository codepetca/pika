import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/student/entries/route'
import { AuthenticationError, requireAuth, requireRole } from '@/lib/auth'
import { resolveClassroomAccess } from '@/lib/server/classroom-access'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'

vi.mock('@/lib/auth', async (original) => ({
  ...await original<typeof import('@/lib/auth')>(), requireAuth: vi.fn(), requireRole: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/classroom-access', () => ({ resolveClassroomAccess: vi.fn() }))
vi.mock('@/lib/server/classrooms', () => ({ assertStudentCanAccessClassroom: vi.fn() }))
const actorId = '11111111-1111-4111-8111-111111111111'
const ownerId = '22222222-2222-4222-8222-222222222222'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const actor = { id: actorId, role: 'teacher' as const, email: 'member@example.invalid' }
const entry = { id: ownerId, student_id: actorId, classroom_id: classroomId, date: '2026-10-01', text: 'Own log' }
const member = { userId: actorId, classroomId, ownerId, relationship: 'member' as const, archived: false }
let query: { select: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn>; neq: ReturnType<typeof vi.fn>; is: ReturnType<typeof vi.fn>; limit: ReturnType<typeof vi.fn>; order: ReturnType<typeof vi.fn> }
function request(search = '') { return new NextRequest(`http://localhost/api/student/entries${search}`) }

describe('GET contextual learner Daily Log history', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    vi.mocked(requireAuth).mockResolvedValue(actor)
    vi.mocked(resolveClassroomAccess).mockResolvedValue(member)
    query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), neq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [{ ...entry, classroom: {
        id: classroomId, teacher_id: ownerId, archived_at: null,
        membership: [{ classroom_id: classroomId, student_id: actorId }],
      } }], error: null }),
    }
    vi.mocked(getServiceRoleClient).mockReturnValue({ from: vi.fn(() => query) } as never)
  })
  afterEach(() => vi.unstubAllEnvs())

  it.each(['teacher', 'student'] as const)('allows the admitted %s member to read own classroom history without exposing the join', async (role) => {
    vi.mocked(requireAuth).mockResolvedValue({ ...actor, role })
    const response = await GET(request(`?classroom_id=${classroomId}`))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ entries: [entry] })
    expect(assertStudentCanAccessClassroom).not.toHaveBeenCalled()
    expect(requireRole).not.toHaveBeenCalled()
    expect(query.limit).not.toHaveBeenCalled()
  })
  it('bounds a broad feed, ignores requested student identity, and caps the existing explicit limit', async () => {
    expect((await GET(request(`?limit=200&student_id=${ownerId}`))).status).toBe(200)
    expect(query.limit).toHaveBeenCalledWith(100)
    expect(query.eq).toHaveBeenCalledWith('student_id', actorId)
    expect(query.eq).not.toHaveBeenCalledWith('student_id', ownerId)
    expect(resolveClassroomAccess).not.toHaveBeenCalled()
  })
  it.each(['', '?limit=0', '?limit=bad'])('retains the 100-entry broad default for %s', async (search) => {
    expect((await GET(request(search))).status).toBe(200)
    expect(query.limit).toHaveBeenCalledWith(100)
  })
  it('honors a smaller requested classroom history limit', async () => {
    expect((await GET(request(`?classroom_id=${classroomId}&limit=10`))).status).toBe(200)
    expect(query.limit).toHaveBeenCalledWith(10)
  })
  it.each([
    [{ ...member, relationship: 'owner', ownerId: actorId }, 403],
    [{ ...member, relationship: 'none' }, 403], [{ ...member, archived: true }, 403], [null, 404],
  ])('denies scoped owner, outsider, archived or absent classroom %#', async (context, status) => {
    vi.mocked(resolveClassroomAccess).mockResolvedValue(context as never)
    const response = await GET(request(`?classroom_id=${classroomId}`))
    expect(response.status).toBe(status)
    expect(query.select).not.toHaveBeenCalled()
  })
  it('rejects invalid contextual classroom IDs before querying entries', async () => {
    expect((await GET(request('?classroom_id=bad'))).status).toBe(400)
    expect(query.select).not.toHaveBeenCalled()
  })
  it('fails malformed admission closed after authentication, with no database access', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', 'bad')
    expect((await GET(request())).status).toBe(503)
    expect(requireAuth).toHaveBeenCalledOnce()
    expect(getServiceRoleClient).not.toHaveBeenCalled()
    vi.mocked(requireAuth).mockRejectedValueOnce(new AuthenticationError())
    expect((await GET(request())).status).toBe(401)
  })
  it('rejects a non-admitted teacher before parameter processing or database access', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [] }))
    expect((await GET(request('?classroom_id=bad'))).status).toBe(403)
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })
  it('does not leak database details or a cross-actor row', async () => {
    query.order.mockResolvedValueOnce({ data: null, error: { message: 'private detail' } })
    let response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: 'Unable to verify Daily Log entries' })
    query.order.mockResolvedValueOnce({ data: [{ ...entry, student_id: ownerId }], error: null })
    response = await GET(request())
    expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain('Own log')
  })
})
