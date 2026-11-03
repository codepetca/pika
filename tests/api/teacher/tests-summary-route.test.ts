import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/teacher/tests/summary/route'
import { authorizeSharedTestListReadActor } from '@/lib/server/contextual-test-list-read'
import { assertTeacherOwnsClassroom } from '@/lib/server/classrooms'

const from = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ from }) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))
vi.mock('@/lib/server/contextual-test-list-read', () => ({ authorizeSharedTestListReadActor: vi.fn(async () => ({ mode: 'legacy' })) }))
vi.mock('@/lib/server/classrooms', () => ({ assertTeacherOwnsClassroom: vi.fn(async () => ({ ok: true })) }))

const request = () => new NextRequest('http://localhost/api/teacher/tests/summary?classroom_id=classroom-1')
describe('teacher Tests summary', () => {
  beforeEach(() => { vi.clearAllMocks() })
  it('denies shared admission and non-owners before reading tests', async () => {
    vi.mocked(authorizeSharedTestListReadActor).mockResolvedValueOnce({ mode: 'shared', user: { id: 'teacher-1' } } as never)
    expect((await GET(request())).status).toBe(404)
    expect(from).not.toHaveBeenCalled()
    vi.mocked(assertTeacherOwnsClassroom).mockResolvedValueOnce({ ok: false, status: 403, error: 'Forbidden' })
    expect((await GET(request())).status).toBe(403)
    expect(from).not.toHaveBeenCalled()
  })
  it('returns fast list fields without reading roster or statistics', async () => {
    const tests = [{ id: 'test-1', classroom_id: 'classroom-1', title: 'Published', status: 'active', documents: [] }]
    from.mockImplementation((table: string) => {
      if (table !== 'tests') throw new Error(`unexpected ${table}`)
      const pending = Promise.resolve({ data: tests, error: null })
      const query: any = { select: () => query, eq: () => query, order: () => query, then: pending.then.bind(pending) }
      return query
    })
    const response = await GET(request())
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.tests[0]).toMatchObject({ id: 'test-1', title: 'Published' })
    expect(body.tests[0]).not.toHaveProperty('stats')
    expect(from.mock.calls.map(([name]) => name)).toEqual(['tests'])
  })
  it('uses the saved draft overlay for titles', async () => {
    from.mockImplementation((table: string) => {
      const value = table === 'tests'
        ? [{ id: 'test-1', classroom_id: 'classroom-1', title: 'Old', status: 'draft', documents: [] }]
        : [{ assessment_id: 'test-1', content: { title: 'Draft title', show_results: true, question_identity_version: 1, questions: [] } }]
      const pending = Promise.resolve({ data: value, error: null })
      const query: any = { select: () => query, eq: () => query, order: () => query, in: () => query, then: pending.then.bind(pending) }
      return query
    })
    const response = await GET(request())
    expect((await response.json()).tests[0]).toMatchObject({ title: 'Draft title', show_results: true })
    expect(from.mock.calls.map(([name]) => name)).toEqual(['tests', 'assessment_drafts'])
  })
})
