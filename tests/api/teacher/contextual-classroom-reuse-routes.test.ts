import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AuthorizationError } from '@/lib/auth'
import { POST as reuse } from '@/app/api/teacher/classrooms/[id]/use-again/route'
import { POST as capture } from '@/app/api/teacher/classrooms/[id]/blueprint/route'
import { GET as list, POST as createBlueprint } from '@/app/api/teacher/course-blueprints/route'
import { GET as detail, PATCH as editBlueprint } from '@/app/api/teacher/course-blueprints/[id]/route'
import { GET as suggestions } from '@/app/api/teacher/course-blueprints/[id]/merge-suggestions/route'
import { POST as merge } from '@/app/api/teacher/course-blueprints/[id]/merge-apply/route'
import { GET as proposals } from '@/app/api/teacher/course-blueprints/[id]/proposals/route'
import { POST as apply } from '@/app/api/teacher/course-blueprints/[id]/proposals/[proposalId]/apply/route'
import { POST as instantiate } from '@/app/api/teacher/course-blueprints/[id]/instantiate/route'
import { makeQueryBuilder, makeSupabaseFromQueues } from '../../support/supabase'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), role: vi.fn(), reuse: vi.fn(), capture: vi.fn(), detail: vi.fn(), list: vi.fn(), instantiate: vi.fn(), suggestions: vi.fn(), merge: vi.fn(), apply: vi.fn(), inverse: vi.fn() }))
let supabase: any
vi.mock('@/lib/auth', async (original) => ({ ...await original<typeof import('@/lib/auth')>(), requireAuth: mocks.auth, requireRole: mocks.role }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => supabase }))
vi.mock('@/lib/server/archived-classroom-reuse', () => ({ prepareArchivedClassroomReuse: mocks.reuse }))
vi.mock('@/lib/server/course-blueprints', () => ({ getCourseBlueprintDetail: mocks.detail, listTeacherCourseBlueprints: mocks.list, hydrateCourseBlueprint: (row: unknown) => row, createClassroomFromBlueprint: mocks.instantiate, createCourseBlueprintFromClassroom: mocks.capture }))
vi.mock('@/lib/server/course-sites', () => ({ getBlueprintMergeSuggestionSet: mocks.suggestions, applyBlueprintMergeSuggestions: mocks.merge }))
vi.mock('@/lib/server/course-blueprint-proposals', () => ({ applyPersistedCourseBlueprintProposal: mocks.apply, applyPersistedClassroomBlueprintProposal: mocks.inverse }))
const actorId = '10000000-0000-4000-8000-000000000001'
const blueprintId = '20000000-0000-4000-8000-000000000001'
const classroomId = '30000000-0000-4000-8000-000000000001'
const proposalId = '40000000-0000-4000-8000-000000000001'
const operationId = '50000000-0000-4000-8000-000000000001'
const proposal = { id: proposalId, teacher_id: actorId, course_blueprint_id: blueprintId, source_classroom_id: classroomId, target_kind: 'blueprint', source_kind: 'classroom', status: 'ready', diff_json: { candidate_snapshot: { reviewed: true } } }
const source = { id: classroomId, teacher_id: actorId, archived_at: '2026-10-01', source_blueprint_id: blueprintId }
const routes = [
  { name: 'reuse', handler: reuse, method: 'POST', path: `classrooms/${classroomId}/use-again` },
  { name: 'list', handler: list, method: 'GET', path: 'course-blueprints' },
  { name: 'detail', handler: detail, method: 'GET', path: `course-blueprints/${blueprintId}` },
  { name: 'suggestions', handler: suggestions, method: 'GET', path: `course-blueprints/${blueprintId}/merge-suggestions?classroomId=${classroomId}` },
  { name: 'merge', handler: merge, method: 'POST', path: `course-blueprints/${blueprintId}/merge-apply`, body: { classroomId, areas: ['overview'], expectedBlueprintRevision: 1, expectedClassroomRevision: 2 } },
  { name: 'proposals', handler: proposals, method: 'GET', path: `course-blueprints/${blueprintId}/proposals` },
  { name: 'apply', handler: apply, method: 'POST', path: `course-blueprints/${blueprintId}/proposals/${proposalId}/apply` },
  { name: 'instantiate', handler: instantiate, method: 'POST', path: `course-blueprints/${blueprintId}/instantiate`, body: { title: 'Course', semester: 'semester1', year: 2026 } },
  { name: 'capture', handler: capture, method: 'POST', path: `classrooms/${classroomId}/blueprint`, body: { title: 'Reusable course' } },
]
function invoke(route: typeof routes[number]) {
  const request = new NextRequest(`http://localhost/api/teacher/${route.path}`, { method: route.method, headers: { 'Idempotency-Key': operationId }, ...(route.body ? { body: JSON.stringify(route.body) } : {}) })
  return route.handler(request, { params: Promise.resolve({ id: ['reuse', 'capture'].includes(route.name) ? classroomId : blueprintId, proposalId }) } as any)
}
describe('contextual reuse route dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    mocks.auth.mockResolvedValue({ id: actorId, role: 'student' })
    mocks.role.mockRejectedValue(new AuthorizationError('Forbidden'))
    mocks.reuse.mockResolvedValue({ ok: true, status: 'ready', blueprint_id: blueprintId })
    mocks.capture.mockResolvedValue({ ok: true, blueprint: { id: blueprintId }, operation_id: operationId, replayed: false })
    mocks.detail.mockResolvedValue({ detail: { id: blueprintId } })
    mocks.list.mockResolvedValue({ data: [{ id: blueprintId }], error: null })
    mocks.suggestions.mockResolvedValue({ ok: true, suggestionSet: {} })
    mocks.merge.mockResolvedValue({ ok: true, proposal })
    mocks.apply.mockResolvedValue({ ok: true, proposal: { ...proposal, status: 'applied' } })
    mocks.instantiate.mockResolvedValue({ ok: true, classroom: { id: 'new' }, operation_id: operationId, replayed: true })
    supabase = makeSupabaseFromQueues({ course_blueprint_change_proposals: [makeQueryBuilder({ data: proposal })], classrooms: [makeQueryBuilder({ data: source })] })
  })
  afterEach(() => vi.unstubAllEnvs())
  for (const route of routes) {
    it.each(['student', 'teacher'])(`${route.name} accepts an admitted %s owner through existing domain writers`, async (role) => {
      mocks.auth.mockResolvedValue({ id: actorId, role })
      mocks.role.mockResolvedValue({ id: actorId, role: 'teacher' })
      if (route.name === 'proposals') supabase = makeSupabaseFromQueues({ course_blueprint_change_proposals: [makeQueryBuilder({ data: [proposal] })], classrooms: [makeQueryBuilder({ data: [source] })] })
      expect((await invoke(route)).status).toBeLessThan(300)
      if (role === 'teacher' && ['suggestions', 'merge', 'proposals', 'apply'].includes(route.name)) {
        expect(mocks.role).toHaveBeenCalledWith('teacher')
      } else expect(mocks.role).not.toHaveBeenCalled()
      expect(mocks.inverse).not.toHaveBeenCalled()
    })
    it.each([undefined, JSON.stringify({ version: 1, admittedUserIds: [] })])(`${route.name} keeps legacy auth for unmatched or absent admission %s`, async (config) => {
      vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', config)
      expect((await invoke(route)).status).toBe(403)
      expect(mocks.role).toHaveBeenCalledWith('teacher')
      expect(mocks.detail).not.toHaveBeenCalled()
      expect(mocks.reuse).not.toHaveBeenCalled()
      expect(mocks.capture).not.toHaveBeenCalled()
    })
    it(`${route.name} fails malformed admission closed`, async () => {
      vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{}')
      expect((await invoke(route)).status).toBe(503)
      expect(mocks.role).not.toHaveBeenCalled()
    })
  }
  it.each([routes[3], routes[4]])('retains admitted teacher active-classroom $name behind its teacher guard', async (route) => {
    mocks.auth.mockResolvedValue({ id: actorId, role: 'teacher' })
    mocks.role.mockResolvedValue({ id: actorId, role: 'teacher' })
    mocks.suggestions.mockImplementation(async (_actor, _blueprint, _classroom, options) => options?.allowActiveLegacy
      ? { ok: true, suggestionSet: {} } : { ok: false, status: 409, error: 'Archived classroom required' })
    mocks.merge.mockImplementation(async (_actor, _blueprint, _classroom, _areas, _expected, options) => options?.allowActiveLegacy
      ? { ok: true, proposal } : { ok: false, status: 409, error: 'Archived classroom required' })
    expect((await invoke(route)).status).toBeLessThan(300)
    expect(mocks.role).toHaveBeenCalledWith('teacher')
  })
  it.each([routes[3], routes[4]])('keeps active-classroom $name unavailable to an admitted student', async (route) => {
    mocks.suggestions.mockImplementation(async (_actor, _blueprint, _classroom, options) => options?.allowActiveLegacy
      ? { ok: true, suggestionSet: {} } : { ok: false, status: 409, error: 'Archived classroom required' })
    mocks.merge.mockImplementation(async (_actor, _blueprint, _classroom, _areas, _expected, options) => options?.allowActiveLegacy
      ? { ok: true, proposal } : { ok: false, status: 409, error: 'Archived classroom required' })
    expect((await invoke(route)).status).toBe(409)
    expect(mocks.role).not.toHaveBeenCalled()
  })
  it('retains all owned proposal types for an admitted teacher after its teacher guard', async () => {
    mocks.auth.mockResolvedValue({ id: actorId, role: 'teacher' })
    mocks.role.mockResolvedValue({ id: actorId, role: 'teacher' })
    const owned = [proposal, { ...proposal, source_kind: 'package' }, { ...proposal, source_kind: 'ai' }, { ...proposal, source_kind: 'repository' }, { ...proposal, target_kind: 'classroom', source_kind: 'blueprint' }]
    supabase = makeSupabaseFromQueues({ course_blueprint_change_proposals: [makeQueryBuilder({ data: owned })], classrooms: [makeQueryBuilder({ data: [source] })] })
    const response = await invoke(routes[5])
    expect(await response.json()).toEqual({ proposals: owned })
    expect(mocks.role).toHaveBeenCalledWith('teacher')
  })
  it('keeps admitted student proposal listing limited to eligible classroom-origin Blueprint targets', async () => {
    const owned = [proposal, { ...proposal, source_kind: 'package' }, { ...proposal, source_kind: 'ai' }, { ...proposal, target_kind: 'classroom', source_kind: 'blueprint' }]
    supabase = makeSupabaseFromQueues({ course_blueprint_change_proposals: [makeQueryBuilder({ data: owned })], classrooms: [makeQueryBuilder({ data: [source] })] })
    expect(await (await invoke(routes[5])).json()).toEqual({ proposals: [proposal] })
    expect(mocks.role).not.toHaveBeenCalled()
  })
  it.each([routes[3], routes[4], routes[5], routes[6]])('requires the explicit legacy guard before teacher $name behavior', async (route) => {
    mocks.auth.mockResolvedValue({ id: actorId, role: 'teacher' })
    expect((await invoke(route)).status).toBe(403)
    expect(mocks.suggestions).not.toHaveBeenCalled()
    expect(mocks.merge).not.toHaveBeenCalled()
    expect(mocks.detail).not.toHaveBeenCalled()
  })
  it('applies an admitted teacher active-source classroom proposal after its teacher guard', async () => {
    mocks.auth.mockResolvedValue({ id: actorId, role: 'teacher' })
    mocks.role.mockResolvedValue({ id: actorId, role: 'teacher' })
    supabase = makeSupabaseFromQueues({ course_blueprint_change_proposals: [makeQueryBuilder({ data: proposal })], classrooms: [makeQueryBuilder({ data: { ...source, archived_at: null } })] })
    expect((await invoke(routes[6])).status).toBe(200)
    expect(mocks.role).toHaveBeenCalledWith('teacher')
    expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({ teacherId: actorId, proposalId, candidate: proposal.diff_json.candidate_snapshot }))
    expect(mocks.inverse).not.toHaveBeenCalled()
  })
  it('denies active-source classroom proposal apply to an admitted student', async () => {
    supabase = makeSupabaseFromQueues({ course_blueprint_change_proposals: [makeQueryBuilder({ data: proposal })], classrooms: [makeQueryBuilder({ data: { ...source, archived_at: null } })] })
    expect((await invoke(routes[6])).status).toBe(403)
    expect(mocks.role).not.toHaveBeenCalled()
    expect(mocks.apply).not.toHaveBeenCalled()
    expect(mocks.inverse).not.toHaveBeenCalled()
  })
  it.each(['package', 'ai', 'repository', 'blueprint'])('requires the teacher guard for an out-of-scope %s proposal', async (source_kind) => {
    supabase = makeSupabaseFromQueues({ course_blueprint_change_proposals: [makeQueryBuilder({ data: { ...proposal, source_kind } })] })
    expect((await invoke(routes[6])).status).toBe(403)
    expect(mocks.apply).not.toHaveBeenCalled()
    expect(mocks.inverse).not.toHaveBeenCalled()
  })
  it('keeps inverse classroom proposals behind the teacher guard', async () => {
    supabase = makeSupabaseFromQueues({ course_blueprint_change_proposals: [makeQueryBuilder({ data: { ...proposal, target_kind: 'classroom' } })] })
    expect((await invoke(routes[6])).status).toBe(403)
    expect(mocks.inverse).not.toHaveBeenCalled()
  })
  it('retains legacy package proposal application for an admitted teacher after its guard', async () => {
    mocks.auth.mockResolvedValue({ id: actorId, role: 'teacher' })
    mocks.role.mockResolvedValue({ id: actorId, role: 'teacher' })
    supabase = makeSupabaseFromQueues({ course_blueprint_change_proposals: [makeQueryBuilder({ data: { ...proposal, source_kind: 'package' } })] })
    expect((await invoke(routes[6])).status).toBe(200)
    expect(mocks.role).toHaveBeenCalledWith('teacher')
    expect(mocks.apply).toHaveBeenCalledOnce()
  })
  it.each([
    { teacher_id: 'other' }, { course_blueprint_id: 'other' }, { source_classroom_id: null },
  ])('rejects stored proposal substitution %j', async (change) => {
    supabase = makeSupabaseFromQueues({ course_blueprint_change_proposals: [makeQueryBuilder({ data: { ...proposal, ...change } })] })
    expect((await invoke(routes[6])).status).toBe(403)
    expect(mocks.apply).not.toHaveBeenCalled()
  })
  it.each([{ teacher_id: 'other' }, { archived_at: null }, { source_blueprint_id: 'other' }])('rejects a revoked proposal source %j', async (change) => {
    supabase = makeSupabaseFromQueues({ course_blueprint_change_proposals: [makeQueryBuilder({ data: proposal })], classrooms: [makeQueryBuilder({ data: { ...source, ...change } })] })
    expect((await invoke(routes[6])).status).toBe(403)
    expect(mocks.apply).not.toHaveBeenCalled()
  })
  it.each([createBlueprint, editBlueprint])('does not admit adjacent Blueprint creation or editing', async (handler) => {
    const request = new NextRequest('http://localhost/api/teacher/course-blueprints', { method: 'POST', body: '{}' })
    const read = vi.spyOn(request, 'json')
    expect((await handler(request, { params: Promise.resolve({ id: blueprintId }) } as any)).status).toBe(403)
    expect(read).not.toHaveBeenCalled()
  })
  it.each([routes[4], routes[7]])('authorizes legacy $name before reading the body', async (route) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', undefined)
    const request = new NextRequest(`http://localhost/api/teacher/${route.path}`, { method: 'POST', body: 'invalid' })
    const read = vi.spyOn(request, 'json')
    expect((await route.handler(request, { params: Promise.resolve({ id: blueprintId }) } as any)).status).toBe(403)
    expect(read).not.toHaveBeenCalled()
  })
  it('retains selected areas and revision guards on manual merge', async () => {
    await invoke(routes[4])
    expect(mocks.merge).toHaveBeenCalledWith(actorId, blueprintId, classroomId, ['overview'], { expectedBlueprintRevision: 1, expectedClassroomRevision: 2 }, { archivedReuse: true })
  })
  it('delegates capacity and replay unchanged on instantiation', async () => {
    const response = await invoke(routes[7])
    expect(mocks.instantiate).toHaveBeenCalledWith(actorId, expect.objectContaining({ blueprintId }), { operationId })
    expect(await response.json()).toMatchObject({ operation_id: operationId, replayed: true })
  })
  it.each(['student', 'teacher'])('connects an admitted %s owner capture to owned reads and existing instantiation', async (role) => {
    mocks.auth.mockResolvedValue({ id: actorId, role })
    const response = await invoke(routes[8])
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ blueprint_id: blueprintId, operation_id: operationId, replayed: false })
    expect(mocks.capture).toHaveBeenCalledExactlyOnceWith(actorId, classroomId, { title: 'Reusable course' }, { operationId })
    expect((await invoke(routes[1])).status).toBe(200)
    expect((await invoke(routes[2])).status).toBe(200)
    expect((await invoke(routes[7])).status).toBe(201)
    expect(mocks.detail).toHaveBeenCalledWith(actorId, blueprintId)
    expect(mocks.instantiate).toHaveBeenCalledWith(actorId, expect.objectContaining({ blueprintId }), { operationId })
    expect(mocks.role).not.toHaveBeenCalled()
  })
  it.each([
    { status: 403, error: 'Forbidden' },
    { status: 403, error: 'Classroom is archived' },
    { status: 409, error: 'Classroom content changed', operation_id: operationId, error_code: 'source_classroom_changed', retryable: false },
  ])('retains the existing capture domain denial $error', async (denial) => {
    mocks.capture.mockResolvedValue({ ok: false, ...denial })
    const response = await invoke(routes[8])
    expect(response.status).toBe(denial.status)
    const { status: _status, ...body } = denial
    expect(await response.json()).toMatchObject(body)
  })
  it('validates capture input and operation identity before domain effects', async () => {
    for (const [body, key] of [[{ title: 12 }, operationId], [{ title: 'Course' }, 'invalid']] as const) {
      const response = await capture(new NextRequest('http://localhost/capture', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: classroomId }) } as any)
      expect(response.status).toBe(400)
    }
    expect(mocks.capture).not.toHaveBeenCalled()
  })
  it('canonicalizes admitted UUID params and source inputs to database UUID spelling', async () => {
    const upper = 'ABCDEF00-0000-4000-8000-000000000001'
    const lower = upper.toLowerCase()
    await capture(new NextRequest('http://localhost/capture', { method: 'POST', headers: { 'Idempotency-Key': operationId }, body: '{}' }), { params: Promise.resolve({ id: upper }) } as any)
    expect(mocks.capture).toHaveBeenCalledWith(actorId, lower, {}, { operationId })
    await reuse(new NextRequest('http://localhost/use-again', { method: 'POST', headers: { 'Idempotency-Key': operationId } }), { params: Promise.resolve({ id: upper }) } as any)
    expect(mocks.reuse).toHaveBeenCalledWith(expect.objectContaining({ classroomId: lower }))
    await merge(new NextRequest('http://localhost/merge', { method: 'POST', body: JSON.stringify({ ...routes[4].body, classroomId: upper }) }), { params: Promise.resolve({ id: upper }) } as any)
    expect(mocks.merge).toHaveBeenCalledWith(actorId, lower, lower, ['overview'], expect.anything(), { archivedReuse: true })
    await suggestions(new NextRequest(`http://localhost/suggestions?classroomId=${upper}`), { params: Promise.resolve({ id: upper }) } as any)
    expect(mocks.suggestions).toHaveBeenCalledWith(actorId, lower, lower, { archivedReuse: true })
  })
  it.each([routes[0], routes[2], routes[3], routes[4], routes[5], routes[6], routes[7], routes[8]])('validates admitted $name params before domain access', async (route) => {
    const request = new NextRequest(`http://localhost/${route.path}`, { method: route.method, ...(route.body ? { body: JSON.stringify(route.body) } : {}) })
    expect((await route.handler(request, { params: Promise.resolve({ id: 'invalid', proposalId }) } as any)).status).toBe(400)
    expect(mocks.reuse).not.toHaveBeenCalled()
    expect(mocks.detail).not.toHaveBeenCalled()
    expect(mocks.instantiate).not.toHaveBeenCalled()
    expect(mocks.capture).not.toHaveBeenCalled()
  })
})
