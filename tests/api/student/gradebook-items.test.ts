import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/student/classrooms/[id]/gradebook-items/route'
import { DEFAULT_CLASSROOM_FEATURE_VISIBILITY } from '@/lib/classroom-feature-visibility'
import { mockAuthenticationError, mockAuthorizationError } from '../setup'

const mocks = vi.hoisted(() => ({ from: vi.fn(), requireRole: vi.fn(), access: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ from: mocks.from }) }))
vi.mock('@/lib/auth', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/server/classrooms', () => ({ assertStudentCanAccessClassroom: mocks.access }))

const classroomId = '11111111-1111-4111-8111-111111111111'
const studentId = '22222222-2222-4222-8222-222222222222'
const item = {
  id: 'item-1', classroom_id: classroomId, title: 'Attendance – Term 1',
  points_possible: 10, include_in_final: true,
  gradebook_categories: { name: 'Term Work', percentage: 100 },
}
const returnedScore = {
  student_id: studentId, classroom_id: classroomId, earned: 0,
  returned_at: '2026-09-10T12:00:00Z', gradebook_items: item,
}

function request(id = classroomId) {
  return GET(new NextRequest(`http://localhost/api/student/classrooms/${id}/gradebook-items`), {
    params: Promise.resolve({ id }),
  })
}

function queryRows(rows: Array<Record<string, unknown>>, error: unknown = null) {
  let start = 0
  let end = Infinity
  const predicates: Array<(row: Record<string, unknown>) => boolean> = []
  const value = (row: Record<string, unknown>, key: string) => key.split('.').reduce<unknown>((entry, field) => (entry as Record<string, unknown>)?.[field], row)
  const query = {
    select: vi.fn().mockReturnThis(),
    range: vi.fn((first: number, last: number) => { start = first; end = last; return query }),
    eq: vi.fn((key: string, expected: unknown) => { predicates.push(row => value(row, key) === expected); return query }),
    not: vi.fn((key: string, operator: string, expected: unknown) => { predicates.push(row => value(row, key) !== expected); return query }),
    order: vi.fn().mockReturnThis(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows.filter(row => predicates.every(predicate => predicate(row))).slice(start, end + 1), error }).then(resolve),
  }
  mocks.from.mockReturnValue(query)
  return query
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireRole.mockResolvedValue({ id: studentId, role: 'student' })
  mocks.access.mockResolvedValue({ ok: true, classroom: { feature_visibility: DEFAULT_CLASSROOM_FEATURE_VISIBILITY } })
})

describe('student returned standalone marks', () => {
  it.each([['unauthenticated', mockAuthenticationError(), 401], ['teacher', mockAuthorizationError(), 403]])('rejects %s callers before reading marks', async (_label, error, status) => {
    mocks.requireRole.mockRejectedValueOnce(error)
    expect((await request()).status).toBe(status)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it.each(['Not enrolled in this classroom', 'Classroom is archived'])('honors classroom access: %s', async error => {
    mocks.access.mockResolvedValueOnce({ ok: false, status: 403, error })
    expect((await request()).status).toBe(403)
    expect(mocks.access).toHaveBeenCalledWith(studentId, classroomId)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('rejects hidden Classwork without reading marks', async () => {
    mocks.access.mockResolvedValueOnce({ ok: true, classroom: { feature_visibility: { ...DEFAULT_CLASSROOM_FEATURE_VISIBILITY, classwork: false } } })
    expect((await request()).status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('validates classroom params', async () => {
    expect((await request('invalid')).status).toBe(400)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('projects only this enrolled student’s returned marks in this classroom, including deliberate zero and exclusions', async () => {
    const query = queryRows([
      returnedScore,
      { ...returnedScore, earned: 8, gradebook_items: { ...item, id: 'item-2', include_in_final: false } },
      { ...returnedScore, earned: 7, returned_at: null },
      { ...returnedScore, earned: null },
      { ...returnedScore, student_id: 'another-student' },
      { ...returnedScore, classroom_id: 'another-classroom' },
      { ...returnedScore, gradebook_items: { ...item, classroom_id: 'another-classroom' } },
    ])
    const response = await request()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ items: [
      { id: 'item-1', title: item.title, earned: 0, possible: 10, percent: 0, categoryName: 'Term Work', included: true },
      { id: 'item-2', title: item.title, earned: 8, possible: 10, percent: 80, categoryName: 'Term Work', included: false },
    ] })
    expect(query.select.mock.calls[0][0]).not.toContain('*')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('keeps returned marks available when the teacher Gradebook tool is hidden', async () => {
    mocks.access.mockResolvedValueOnce({ ok: true, classroom: { feature_visibility: { ...DEFAULT_CLASSROOM_FEATURE_VISIBILITY, gradebook: false } } })
    queryRows([returnedScore])
    expect((await request()).status).toBe(200)
  })

  it('reports failed reads separately from an empty returned set', async () => {
    queryRows([], { message: 'database unavailable' })
    expect((await request()).status).toBe(500)
  })

  it.each(['42P01', 'PGRST205'])('tolerates unapplied tables with %s during rollout', async code => {
    queryRows([], { code })
    expect(await (await request()).json()).toEqual({ items: [] })
  })

  it.each([null, { name: 'Practice', percentage: 0 }])('labels non-contributing categories as not counted: %s', async category => {
    queryRows([{ ...returnedScore, gradebook_items: { ...item, gradebook_categories: category } }])
    const data = await (await request()).json()
    expect(data.items[0].included).toBe(false)
  })

  it('reads beyond the database default page limit', async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => ({ ...returnedScore, gradebook_items: { ...item, id: `item-${index}` } }))
    const query = queryRows(rows)
    const data = await (await request()).json()
    expect(data.items).toHaveLength(1001)
    expect(data.items[1000].id).toBe('item-1000')
    expect(query.range).toHaveBeenCalledWith(1000, 1999)
  })

  it('returns an empty list when no marks were returned', async () => {
    queryRows([])
    expect(await (await request()).json()).toEqual({ items: [] })
  })
})
