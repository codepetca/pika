import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET as studentList } from '@/app/api/student/assignments/route'
import { GET as teacherList, POST as create } from '@/app/api/teacher/assignments/route'
import { GET as detail, PATCH as update, DELETE as remove } from '@/app/api/teacher/assignments/[id]/route'
import { POST as reorder } from '@/app/api/teacher/assignments/reorder/route'
import { POST as release } from '@/app/api/teacher/assignments/[id]/release/route'
import { POST as bulk } from '@/app/api/teacher/assignments/bulk/route'
import { GET as openDoc, PATCH as saveDoc } from '@/app/api/assignment-docs/[id]/route'
import { POST as submit } from '@/app/api/assignment-docs/[id]/submit/route'
import { POST as unsubmit } from '@/app/api/assignment-docs/[id]/unsubmit/route'
import { GET as history } from '@/app/api/assignment-docs/[id]/history/route'
import { POST as restore } from '@/app/api/assignment-docs/[id]/restore/route'
import { expectContentFreeDiagnostic, privateDiagnosticError } from '../helpers/diagnostics'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => client) }))
vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async (role: string) => ({ id: role === 'teacher' ? currentTeacherId : `${role}-1`, role })),
  requireAuth: vi.fn(async () => ({ id: 'student-1', role: 'student' })),
}))
vi.mock('@/lib/server/classrooms', () => ({
  assertStudentCanAccessClassroom: vi.fn(async () => ({ ok: true })),
  assertTeacherOwnsClassroom: vi.fn(async () => ({ ok: true })),
  assertTeacherCanMutateClassroom: vi.fn(async () => ({ ok: true })),
  getClassroomStudentIds: vi.fn(async () => rosterResult),
}))
vi.mock('@/lib/server/assignment-ai-grading-runs', () => ({
  getActiveAssignmentAiGradingRunSummary: vi.fn(async () => null),
}))
vi.mock('@/lib/server/assignment-submission-artifacts', () => ({
  loadAssignmentSubmissionRequirements: vi.fn(async () => []),
  loadAssignmentSubmissionArtifactsForDocs: vi.fn(async () => {
    if (artifactFailure) throw privateDiagnosticError
    return []
  }),
  loadAssignmentSubmissionArtifactsForDoc: vi.fn(async () => []),
  loadUserGitHubIdentity: vi.fn(async () => null),
  updateAssignmentWithSubmissionRequirementsAtomic: vi.fn(async () => ({
    ok: true, assignment: assignment(), submissionRequirements: [],
  })),
}))
vi.mock('@/lib/server/assignment-feedback', () => ({
  loadAssignmentFeedbackEntries: vi.fn(async () => []),
}))
vi.mock('@/lib/server/assignment-artifact-storage-cleanup', () => ({
  runAssignmentArtifactStorageCleanup: vi.fn(async () => {
    if (cleanupFailure) throw privateDiagnosticError
    return { claimed: 0, completed: 0, failed: 0 }
  }),
}))
vi.mock('@/lib/server/assignment-doc-submissions', () => ({
  submitAssignmentDocAtomic: vi.fn(async () => ({ ok: true, doc: { ...document(), is_submitted: true } })),
}))
vi.mock('@/lib/server/pal-config', () => ({
  isPalEnabled: vi.fn(() => palEnabled),
  isClassroomPalRequested: vi.fn(() => true),
}))
vi.mock('@/lib/server/pal-source-writes', () => ({
  createAssignmentDocWithPalEvent: vi.fn(async () => { throw privateDiagnosticError }),
}))
vi.mock('@/lib/authenticity', () => ({
  analyzeAuthenticity: vi.fn(() => { throw privateDiagnosticError }),
}))

type Reply = { data: any; error: unknown }
const replies = new Map<string, Reply[]>()
let currentTeacherId = 'teacher-1'
let artifactFailure = false
let cleanupFailure = false
let palEnabled = false
let rosterResult: { studentIds: string[]; studentIdSet: Set<string>; error: unknown }

function assignment() {
  return {
    id: 'assignment-1', classroom_id: 'classroom-1', title: 'Synthetic assignment',
    is_draft: false, released_at: '2026-01-01T00:00:00.000Z',
    due_at: '2099-01-01T00:00:00.000Z',
    classrooms: { id: 'classroom-1', teacher_id: currentTeacherId, archived_at: null },
  }
}
const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Synthetic work' }] }] }
function document() {
  return {
    id: 'doc-1', assignment_id: 'assignment-1', student_id: 'student-1',
    content, is_submitted: false, updated_at: '2026-01-01T00:00:00.000Z',
    viewed_at: '2026-01-01T00:00:00.000Z',
  }
}
function ok(data: unknown): Reply { return { data, error: null } }
function failed(): Reply { return { data: null, error: privateDiagnosticError } }
function queue(table: string, ...results: Reply[]) { replies.set(table, results) }

// A thenable query keeps the real route and query-chunk loaders in the test.
// Each from() consumes one explicit reply; no database or provider is contacted.
function query(result: Reply) {
  const chain: Record<string, any> = {}
  for (const method of ['select', 'eq', 'in', 'order', 'range', 'limit', 'single', 'maybeSingle', 'insert', 'update', 'delete', 'not']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.then = (resolve: (value: Reply) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
  return chain
}
const client = {
  from: vi.fn((table: string) => query(replies.get(table)?.shift() ?? ok(
    table === 'assignments' ? assignment() : table === 'assignment_docs' ? document() : [],
  ))),
  rpc: vi.fn(async (_name?: string, _args?: Record<string, unknown>) => failed()),
}
const context = { params: { id: 'assignment-1' } }
function request(method = 'GET', body?: unknown) {
  return new NextRequest('http://localhost:3000/api/synthetic?classroom_id=classroom-1', {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
}
const createBody = { classroom_id: 'classroom-1', title: 'Synthetic assignment', due_at: '2099-01-01T00:00:00.000Z' }
const bulkItem = { title: 'Synthetic assignment', due_at: createBody.due_at, instructions: '', is_draft: true, position: 0 }
async function expectFailure(response: Response, error: string, event: string) {
  expect(response.status).toBe(500)
  expect(await response.json()).toEqual({ error })
  expectContentFreeDiagnostic(vi.mocked(console.error).mock.calls, event)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  replies.clear()
  currentTeacherId = 'teacher-1'
  client.rpc.mockImplementation(async () => failed())
  artifactFailure = cleanupFailure = palEnabled = false
  rosterResult = { studentIds: ['student-1'], studentIdSet: new Set(['student-1']), error: null }
})
afterEach(() => vi.restoreAllMocks())

describe('assignment route diagnostic privacy', () => {
  it('keeps student list failures content-free', async () => {
    queue('assignments', failed())
    await expectFailure(await studentList(request()), 'Failed to fetch assignments', 'assignment.student_list')
  })

  it('logs only the terminal teacher list fallback error', async () => {
    queue('assignments', { data: null, error: { message: 'PRIVATE_INITIAL_ERROR' } }, failed())
    await expectFailure(await teacherList(request()), 'Failed to fetch assignments', 'assignment.list')
    expect(client.from).toHaveBeenCalledTimes(2)
  })

  it('keeps teacher list roster failures content-free', async () => {
    queue('assignments', ok([]))
    rosterResult.error = privateDiagnosticError
    await expectFailure(await teacherList(request()), 'Failed to fetch classroom enrollments', 'assignment.list_enrollments')
  })

  it('keeps teacher list document failures content-free', async () => {
    queue('assignments', ok([assignment()]))
    queue('assignment_docs', failed())
    await expectFailure(await teacherList(request()), 'Failed to fetch assignment stats', 'assignment.list_documents')
  })

  it.each([
    ['assignments', 'assignment.create_assignment_position'],
    ['classwork_materials', 'assignment.create_material_position'],
    ['surveys', 'assignment.create_survey_position'],
  ])('keeps create position failures content-free: %s', async (table, event) => {
    queue(table, failed())
    await expectFailure(await create(request('POST', createBody)), 'Failed to create assignment', event)
  })

  it('keeps assignment creation failures content-free', async () => {
    queue('assignments', ok(null), failed())
    await expectFailure(await create(request('POST', createBody)), 'Failed to create assignment', 'assignment.create')
  })

  it.each([
    ['classroom_enrollments', 'Failed to fetch students', 'assignment.detail_enrollments'],
    ['student_profiles', 'Failed to fetch student profiles', 'assignment.detail_profiles'],
    ['assignment_docs', 'Failed to fetch assignment docs', 'assignment.detail_documents'],
    ['assignment_doc_history', 'Failed to fetch assignment doc history', 'assignment.detail_history'],
  ])('keeps assignment detail query failures content-free: %s', async (table, error, event) => {
    queue('classroom_enrollments', ok([{ student_id: 'student-1', users: { id: 'student-1', email: 'synthetic@example.invalid' } }]))
    queue('student_profiles', ok([]))
    queue('assignment_docs', ok([document()]))
    queue(table, failed())
    await expectFailure(await detail(request(), context), error, event)
  })

  it('keeps assignment artifact lookup failures content-free', async () => {
    queue('classroom_enrollments', ok([]))
    artifactFailure = true
    await expectFailure(await detail(request(), context), 'Failed to fetch assignment submission artifacts', 'assignment.detail_artifacts')
  })

  it('keeps submitted document checks content-free', async () => {
    queue('assignment_docs', failed())
    await expectFailure(await update(request('PATCH', { submission_requirements: [] }), context), 'Failed to verify assignment submissions', 'assignment.update_submitted_documents')
  })

  it('keeps assignment update failures content-free', async () => {
    queue('assignments', ok(assignment()), failed())
    await expectFailure(await update(request('PATCH', { title: 'Updated title' }), context), 'Failed to update assignment', 'assignment.update')
  })

  it('preserves successful assignment updates when queued cleanup fails', async () => {
    queue('assignment_docs', ok(null))
    cleanupFailure = true
    const response = await update(request('PATCH', { submission_requirements: [] }), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ assignment: { ...assignment(), instructions_markdown: '', submission_requirements: [] } })
    expectContentFreeDiagnostic(vi.mocked(console.error).mock.calls, 'assignment.update_cleanup')
  })

  function deletionTransport(failFinalize = false) {
    currentTeacherId = '11111111-1111-4111-8111-111111111111'
    const assignmentId = '22222222-2222-4222-8222-222222222222'
    const classroomId = '33333333-3333-4333-8333-333333333333'
    const operationId = '44444444-4444-4444-8444-444444444444'
    queue('assignments', ok({ ...assignment(), id: assignmentId, classroom_id: classroomId }))
    client.rpc.mockImplementation(async (name, inputArgs) => {
      const args = inputArgs!
      expect(args.p_actor_id).toBe(currentTeacherId)
      if (name === 'get_repolight_assignment_delete_context_v1') {
        expect(args.p_assignment_id).toBe(assignmentId)
        return ok({ assignment_id: assignmentId, classroom_id: classroomId,
          assignment_updated_at: '2026-01-01T00:00:00.000Z', source_fingerprint: 'a'.repeat(64), pending_operation_id: null, subject_count: 0 })
      }
      expect(args.p_operation_id).toBe(operationId)
      if (name === 'reserve_repolight_assignment_delete_v1') {
        expect(args).toMatchObject({ p_assignment_id: assignmentId, p_expected_updated_at: '2026-01-01T00:00:00.000Z', p_expected_source_fingerprint: 'a'.repeat(64) })
        return ok({ operation_id: operationId, kind: 'assignment_delete', status: 'cleanup_pending', pending_subject_count: 0 })
      }
      if (name === 'read_repolight_decommission_subjects_v1') return ok([])
      if (name === 'finalize_repolight_assignment_delete_v1') {
        expect(args.p_assignment_id).toBe(assignmentId)
        return failFinalize ? failed() : ok({ ok: true, deleted: true })
      }
      throw new Error('Unexpected deletion RPC')
    })
    return { params: Promise.resolve({ id: assignmentId }), request: request('DELETE', { operationId }) }
  }

  it('keeps guarded assignment deletion failures content-free and never claims success', async () => {
    const input = deletionTransport(true)
    const response = await remove(input.request, input)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Assignment deletion could not continue. Retry the confirmed operation.' })
    expectContentFreeDiagnostic(vi.mocked(console.error).mock.calls, 'assignment.delete')
    expect(client.rpc.mock.calls.map(call => call[0])).toEqual(['get_repolight_assignment_delete_context_v1',
      'reserve_repolight_assignment_delete_v1', 'read_repolight_decommission_subjects_v1', 'read_repolight_decommission_subjects_v1',
      'finalize_repolight_assignment_delete_v1'])
  })

  it('fails closed when the guarded deletion RPC is absent, without falling back to table deletion', async () => {
    const input = deletionTransport()
    client.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'PRIVATE_MISSING_FUNCTION_DETAIL' } })
    const response = await remove(input.request, input)
    expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain('PRIVATE_MISSING_FUNCTION_DETAIL')
    expect(client.rpc).toHaveBeenCalledOnce()
    for (const call of client.from.mock.results) expect(call.value.delete).not.toHaveBeenCalled()
    expectContentFreeDiagnostic(vi.mocked(console.error).mock.calls, 'assignment.delete', 'unexpected')
  })

  it('preserves verified assignment deletions when queued cleanup fails', async () => {
    const input = deletionTransport()
    cleanupFailure = true
    const response = await remove(input.request, input)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expectContentFreeDiagnostic(vi.mocked(console.error).mock.calls, 'assignment.delete_cleanup')
  })

  it('keeps reorder RPC failures content-free', async () => {
    await expectFailure(await reorder(request('POST', { classroom_id: 'classroom-1', assignment_ids: ['assignment-1'] })), 'Failed to reorder assignments', 'assignment.reorder')
  })

  it('keeps release failures content-free', async () => {
    queue('assignments', ok({ ...assignment(), is_draft: true }), failed())
    await expectFailure(await release(request('POST', {}), context), 'Failed to release assignment', 'assignment.release')
  })

  it('keeps existing bulk lookup failures content-free', async () => {
    queue('assignments', failed())
    await expectFailure(await bulk(request('POST', { classroom_id: 'classroom-1', assignments: [{ ...bulkItem, id: 'assignment-1' }] })), 'Failed to fetch existing assignments', 'assignment.bulk_existing')
  })

  it.each([
    ['classwork_materials', 'assignment.bulk_material_positions'],
    ['surveys', 'assignment.bulk_survey_positions'],
  ])('keeps bulk position failures content-free: %s', async (table, event) => {
    queue(table, failed())
    await expectFailure(await bulk(request('POST', { classroom_id: 'classroom-1', assignments: [bulkItem] })), 'Failed to save assignments', event)
  })

  it('keeps bulk creation failures content-free', async () => {
    queue('assignments', failed())
    await expectFailure(await bulk(request('POST', { classroom_id: 'classroom-1', assignments: [bulkItem] })), 'Failed to create assignments', 'assignment.bulk_create')
  })

  it('keeps bulk update failures content-free', async () => {
    queue('assignments', ok([{ ...assignment(), is_draft: true }]), failed())
    await expectFailure(await bulk(request('POST', { classroom_id: 'classroom-1', assignments: [{ ...bulkItem, id: 'assignment-1' }] })), 'Failed to update assignments', 'assignment.bulk_update')
  })

  it('keeps document read failures content-free', async () => {
    queue('assignment_docs', failed())
    await expectFailure(await openDoc(request(), context), 'Failed to fetch assignment doc', 'assignment.document_read')
  })

  it('keeps document creation failures content-free', async () => {
    queue('assignment_docs', { data: null, error: { code: 'PGRST116' } }, failed())
    await expectFailure(await openDoc(request(), context), 'Failed to create assignment doc', 'assignment.document_create')
  })

  it('keeps document outbox creation failures content-free', async () => {
    palEnabled = true
    queue('assignment_docs', { data: null, error: { code: 'PGRST116' } })
    await expectFailure(await openDoc(request(), context), 'Failed to create assignment doc', 'assignment.document_create_outbox')
  })

  it('preserves document reads and notifications when viewed-at writes fail', async () => {
    queue('assignment_docs', ok({ ...document(), viewed_at: null }), failed())
    const response = await openDoc(request(), context)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.doc.id).toBe('doc-1')
    expect(body.doc.viewed_at).toBeNull()
    expect(body.wasFirstView).toBe(false)
    expectContentFreeDiagnostic(vi.mocked(console.error).mock.calls, 'assignment.document_viewed')
  })

  it('keeps document save lookup failures content-free', async () => {
    queue('assignment_docs', failed())
    await expectFailure(await saveDoc(request('PATCH', { content }), context), 'Failed to fetch assignment doc', 'assignment.document_save_read')
  })

  it('keeps document unsubmit lookup failures content-free', async () => {
    queue('assignment_docs', failed())
    await expectFailure(await unsubmit(request('POST'), context), 'Failed to fetch assignment doc', 'assignment.document_unsubmit_read')
  })

  it('keeps document submit lookup failures content-free', async () => {
    queue('assignment_docs', failed())
    await expectFailure(await submit(request('POST', { content, expected_updated_at: document().updated_at }), context), 'Failed to fetch assignment doc', 'assignment.document_submit_read')
  })

  it('preserves committed submissions when authenticity analysis fails', async () => {
    queue('assignment_doc_history', ok([{}, {}]))
    const response = await submit(request('POST', { content, expected_updated_at: document().updated_at }), context)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.doc.is_submitted).toBe(true)
    expect(body.doc.content).toEqual(content)
    expectContentFreeDiagnostic(vi.mocked(console.error).mock.calls, 'assignment.document_authenticity')
  })

  it('keeps history lookup failures content-free', async () => {
    queue('classroom_enrollments', ok({ id: 'enrollment-1' }))
    queue('assignment_doc_history', failed())
    await expectFailure(await history(request(), context), 'Failed to fetch history', 'assignment.history_read')
  })

  it('keeps history restore lookup failures content-free', async () => {
    queue('assignment_doc_history', failed())
    await expectFailure(await restore(request('POST', { history_id: '10000000-0000-4000-8000-000000000001' }), context), 'Failed to fetch history', 'assignment.history_restore_read')
  })
})
