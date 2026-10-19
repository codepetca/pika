import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), role: vi.fn(), client: vi.fn(), legacy: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth, requireRole: mocks.role }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: mocks.client }))
vi.mock('@/lib/server/gradebook', () => ({ loadTeacherGradebook: mocks.legacy, updateTeacherGradebook: mocks.legacy, replaceTeacherGradebookCategories: mocks.legacy, saveTeacherGradebookScoreOverride: mocks.legacy, deleteTeacherGradebookScoreOverride: mocks.legacy }))
vi.mock('@/lib/server/student-grades', () => ({ getStudentGrades: mocks.legacy }))
vi.mock('@/lib/server/gradebook-student-items', () => ({ getStudentReturnedGradebookItems: mocks.legacy }))
vi.mock('@/lib/server/gradebook-items', () => ({ mutateTeacherGradebookItem: mocks.legacy, setTeacherGradebookItemScore: mocks.legacy }))
vi.mock('@/lib/server/gradebook-maximum', () => ({ isGradebookMaximumEditingEnabled: () => true, saveGradebookMaximum: mocks.legacy }))
import { GET as ownerGet, PATCH, PUT as categoriesPut } from '@/app/api/teacher/gradebook/route'
import { PUT as overridePut, DELETE as overrideDelete } from '@/app/api/teacher/gradebook/manual-scores/route'
import { POST as itemPost } from '@/app/api/teacher/gradebook/items/route'
import { PUT as scorePut } from '@/app/api/teacher/gradebook/items/scores/route'
import { PUT as maximumPut } from '@/app/api/teacher/gradebook/maximums/route'
import { GET as gradesGet } from '@/app/api/student/classrooms/[id]/grades/route'
import { GET as itemsGet } from '@/app/api/student/classrooms/[id]/gradebook-items/route'

const actor = '11111111-1111-4111-8111-111111111111', classroom = '22222222-2222-4222-8222-222222222222'
const resource = '33333333-3333-4333-8333-333333333333', student = '44444444-4444-4444-8444-444444444444'
const empty = { roster: [], profiles: [], categories: [], assignments: [], assignment_docs: [], tests: [], test_questions: [], test_responses: [], test_attempts: [], items: [], item_scores: [], score_overrides: [] }
function request(body?: unknown) { return new NextRequest(`http://localhost/api/teacher/gradebook?classroom_id=${classroom}`, body ? { method: 'POST', body: JSON.stringify(body) } : undefined) }
function reply(data: unknown, error: unknown = null, status = 200) {
  const abortSignal = vi.fn().mockResolvedValue({ data, error, status })
  const rpc = vi.fn(() => ({ abortSignal })); mocks.client.mockReturnValue({ rpc }); return rpc
}
const owner = { actor_id: actor, classroom: { id: classroom, teacher_id: actor, archived_at: null } }
const run = (route: Function, body: unknown) => route(request(body), { params: Promise.resolve({}) })
beforeEach(() => { vi.clearAllMocks(); process.env.PIKA_CLASSROOM_EXPERIENCE_ADMISSION = JSON.stringify({ version: 1, admittedUserIds: [actor] }); mocks.auth.mockResolvedValue({ id: actor, role: 'student' }) })
afterEach(() => { delete process.env.PIKA_CLASSROOM_EXPERIENCE_ADMISSION })
describe('contextual Gradebook routes', () => {
  it('uses owner relation despite historical student role with one RPC', async () => {
    const rpc = reply({ ...owner, operation: 'owner-read', selected_student_id: null, source: empty })
    const response = await ownerGet(request(), { params: Promise.resolve({}) })
    expect(response.status).toBe(200); expect((await response.json()).students).toEqual([])
    expect(rpc).toHaveBeenCalledTimes(1); expect(mocks.role).not.toHaveBeenCalled(); expect(mocks.legacy).not.toHaveBeenCalled()
  })
  it('returns the selected enrolled student inspector with saved marks through the actual contextual service', async () => {
    const date = '2026-10-10T12:00:00Z'
    const rpc = reply({ ...owner, operation: 'owner-read', selected_student_id: student, source: {
      ...empty, roster: [{ student_id: student, email: 'synthetic@example.invalid' }],
      categories: [{ id: resource, classroom_id: classroom, name: 'Term', percentage: 100, default_assessment_weight: 10, position: 0, is_default: true }],
      items: [{ id: resource, classroom_id: classroom, title: 'Saved mark', points_possible: 10, gradebook_weight: 1, gradebook_category_id: resource, include_in_final: true, created_at: date, gradebook_maximum_override: null, gradebook_score_scale: 1 }],
      item_scores: [{ item_id: resource, classroom_id: classroom, student_id: student, earned: 7, returned_at: null, updated_at: date }],
    } })
    const response = await ownerGet(new NextRequest(`http://localhost/api/teacher/gradebook?classroom_id=${classroom}&student_id=${student}`), { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.students).toHaveLength(1)
    expect(result.selected_student).toMatchObject({ student_id: student, assessment_scores: [{ assessment_type: 'item', assessment_id: resource, earned: 7, possible: 10, percent: 70 }] })
    expect(result.selected_student.assessment_scores).toEqual(result.students[0].assessment_scores)
    expect(rpc).toHaveBeenCalledTimes(1); expect(mocks.role).not.toHaveBeenCalled(); expect(mocks.legacy).not.toHaveBeenCalled()
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })
  it.each([
    [PATCH, { classroom_id: classroom, assessment_type: 'assignment', assessment_id: resource, gradebook_weight: 0 }, 'assessment_weight', { assessment_type: 'assignment', assessment_id: resource }, { assessment: { assessment_type: 'assignment', assessment_id: resource, weight: 0 } }],
    [overridePut, { classroom_id: classroom, student_id: student, assessment_type: 'assignment', assessment_id: resource, earned: 0 }, 'override_save', { assessment_type: 'assignment', assessment_id: resource, student_id: student }, { saved: true }],
    [overrideDelete, { classroom_id: classroom, scope: 'all' }, 'override_delete_all', {}, { deleted: true }],
    [itemPost, { classroom_id: classroom, action: 'delete', item_id: resource }, 'item_delete', { item_id: resource }, { ok: true, deleted: true }],
    [scorePut, { classroom_id: classroom, item_id: resource, student_id: student, earned: null }, 'item_score', { item_id: resource, student_id: student }, { saved: true }],
    [maximumPut, { classroom_id: classroom, assessment_type: 'item', assessment_id: resource, maximum: null, mode: 'reset', expected_maximum: 10, expected_scale: 1 }, 'maximum', { assessment_type: 'item', assessment_id: resource }, { saved: true }],
  ])('adapts one authorized transaction to unchanged response %#', async (route, body, operation, target, result) => {
    const rpc = reply({ ...owner, operation, target, result })
    const response = await run(route, body)
    expect(response.status).toBe(200); expect(await response.json()).toEqual(result)
    expect(rpc).toHaveBeenCalledTimes(1); expect(rpc.mock.calls[0][0]).toBe('mutate_gradebook_for_owner_v1')
    expect(mocks.role).not.toHaveBeenCalled(); expect(mocks.legacy).not.toHaveBeenCalled()
  })
  it('returns category public rows without the contextual target or classroom field', async () => {
    const category = { id: resource, name: 'Term', percentage: 100, default_assessment_weight: 10, position: 0, is_default: true }
    const rpc = reply({ ...owner, operation: 'categories_replace', target: { category_ids: [resource] }, result: { categories: [{ ...category, classroom_id: classroom }] } })
    const response = await run(categoriesPut, { classroom_id: classroom, categories: [category] })
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ categories: [category] }); expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('preserves retired settings after owner and archive authorization', async () => {
    reply({ ...owner, operation: 'owner-read', selected_student_id: null, source: empty })
    expect((await run(PATCH, { classroom_id: classroom, use_weights: true })).status).toBe(410)
    reply({ ...owner, classroom: { ...owner.classroom, archived_at: '2026-10-01T12:00:00Z' }, operation: 'owner-read', selected_student_id: null, source: empty })
    expect((await run(PATCH, { classroom_id: classroom, use_weights: true })).status).toBe(403)
  })
  it.each([[gradesGet, 'grades'], [itemsGet, 'items']])('reads current nonowner members despite historical teacher role %#', async (route, view) => {
    mocks.auth.mockResolvedValue({ id: actor, role: 'teacher' })
    const { roster: _roster, profiles: _profiles, ...source } = empty
    const rpc = reply({ actor_id: actor, classroom: { id: classroom, teacher_id: student, archived_at: null }, operation: `member-${view}`, source: { ...source, student_id: actor, visibility: { classwork: true, tests: true, student_grades: true, gradebook_compact_zero_weight_assessments: true } } })
    const response = await route(request(), { params: Promise.resolve({ id: classroom }) })
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(rpc).toHaveBeenCalledTimes(1); expect(mocks.role).not.toHaveBeenCalled(); expect(mocks.legacy).not.toHaveBeenCalled()
  })
  it('preserves the original guard and service for a nonadmitted actor', async () => {
    process.env.PIKA_CLASSROOM_EXPERIENCE_ADMISSION = JSON.stringify({ version: 1, admittedUserIds: [] })
    mocks.role.mockResolvedValue({ id: actor, role: 'teacher' }); mocks.legacy.mockResolvedValue({ original: true })
    const response = await ownerGet(request(), { params: Promise.resolve({}) })
    expect(await response.json()).toEqual({ original: true }); expect(mocks.role).toHaveBeenCalledWith('teacher'); expect(mocks.client).not.toHaveBeenCalled()
  })
})
