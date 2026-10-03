import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { requireAuth, requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { PATCH as edit, DELETE as remove } from '@/app/api/teacher/assignments/[id]/route'
import { POST as release } from '@/app/api/teacher/assignments/[id]/release/route'
import { POST as discard } from '@/app/api/teacher/assignments/[id]/discard-pristine/route'
import { POST as grade } from '@/app/api/teacher/assignments/[id]/grade/route'
import { POST as gradeSelected } from '@/app/api/teacher/assignments/[id]/grade-selected/route'
import { PUT as repoTarget } from '@/app/api/teacher/assignments/[id]/repo-targets/[studentId]/route'
import { POST as returnFeedback } from '@/app/api/teacher/assignments/[id]/feedback-return/route'
import { POST as returnDocs } from '@/app/api/teacher/assignments/[id]/return/route'
import { POST as create } from '@/app/api/teacher/assignments/route'
import { POST as createSurvey } from '@/app/api/teacher/surveys/route'
import { POST as bulk } from '@/app/api/teacher/assignments/bulk/route'
import { POST as reorder } from '@/app/api/teacher/assignments/reorder/route'
import { POST as reorderClasswork } from '@/app/api/teacher/classrooms/[id]/classwork/reorder/route'
import { PATCH as save } from '@/app/api/assignment-docs/[id]/route'
import { POST as submit } from '@/app/api/assignment-docs/[id]/submit/route'
import { POST as unsubmit } from '@/app/api/assignment-docs/[id]/unsubmit/route'
import { GET as history } from '@/app/api/assignment-docs/[id]/history/route'
import { POST as restore } from '@/app/api/assignment-docs/[id]/restore/route'
import { DELETE as artifactDelete, PUT as artifactPut } from '@/app/api/assignment-docs/[id]/artifacts/[requirementId]/route'

vi.mock('@/lib/auth', async (original) => ({
  ...await original<typeof import('@/lib/auth')>(), requireAuth: vi.fn(), requireRole: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))

const actorId = '11111111-1111-4111-8111-111111111111'
const assignmentId = '22222222-2222-4222-8222-222222222222'
const classroomId = '33333333-3333-4333-8333-333333333333'
const studentId = '44444444-4444-4444-8444-444444444444'
const requirementId = '55555555-5555-4555-8555-555555555555'
const revision = '2026-10-03T12:00:00.000Z'
const content = { type: 'doc', content: [] }
const cases = [
  { name: 'edit', handler: edit, method: 'PATCH', body: { title: 'Updated' }, rpc: 'update_assignment_for_owner_v1' },
  { name: 'delete', handler: remove, method: 'DELETE', rpc: 'delete_assignment_for_owner_v1' },
  { name: 'release', handler: release, method: 'POST', body: {}, rpc: 'release_assignment_for_owner_v1' },
  { name: 'discard', handler: discard, method: 'POST', body: { expected_updated_at: revision }, rpc: 'discard_pristine_assignment_draft_for_owner_v1' },
  { name: 'grade', handler: grade, method: 'POST', body: { student_id: studentId, score_completion: 0, score_thinking: 0, score_workflow: 0, feedback: '', expected_doc_updated_at: revision }, rpc: 'save_assignment_grades_for_owner_v1' },
  { name: 'selected grade', handler: gradeSelected, method: 'POST', body: { student_ids: [studentId], score_completion: 0, score_thinking: 0, score_workflow: 0, feedback: '', expected_doc_updated_at_by_student: { [studentId]: revision } }, rpc: 'save_assignment_grades_for_owner_v1' },
  { name: 'repo target reset', handler: repoTarget, method: 'PUT', body: { selection_mode: 'auto' }, rpc: 'save_assignment_repo_target_for_owner_v1' },
  { name: 'feedback return', handler: returnFeedback, method: 'POST', body: { student_id: studentId, feedback: 'Comments', expected_doc_updated_at: revision }, rpc: 'return_assignment_feedback_for_owner_v1' },
  { name: 'return', handler: returnDocs, method: 'POST', body: { student_ids: [studentId] }, rpc: 'return_assignment_docs_for_owner_v1' },
  { name: 'create', handler: create, method: 'POST', body: { classroom_id: classroomId, title: 'New', due_at: '2099-10-03T12:00:00Z' }, rpc: 'create_assignment_for_owner_v1' },
  { name: 'create survey', handler: createSurvey, method: 'POST', body: { classroom_id: classroomId, title: 'New survey' }, rpc: 'create_survey_for_owner_v1' },
  { name: 'bulk', handler: bulk, method: 'POST', body: { classroom_id: classroomId, assignments: [] }, rpc: 'save_assignments_bulk_for_owner_v1' },
  { name: 'reorder', handler: reorder, method: 'POST', body: { classroom_id: classroomId, assignment_ids: [assignmentId] }, rpc: 'reorder_assignments_for_owner_v1' },
  { name: 'mixed reorder', handler: reorderClasswork, method: 'POST', classroom: true, body: { items: [{ type: 'assignment', id: assignmentId }] }, rpc: 'reorder_classwork_items_for_owner_v1' },
  { name: 'save', handler: save, method: 'PATCH', body: { content, expected_updated_at: revision, save_session_id: requirementId, save_sequence: 1, metric_session_id: requirementId }, rpc: 'save_assignment_doc_for_member_v1' },
  { name: 'submit preflight', handler: submit, method: 'POST', body: { content, expected_updated_at: revision }, rpc: 'prepare_assignment_doc_submission_for_member_v1' },
  { name: 'unsubmit', handler: unsubmit, method: 'POST', rpc: 'unsubmit_assignment_doc_for_member_v1' },
  { name: 'history', handler: history, method: 'GET', rpc: 'get_assignment_doc_history_for_actor_v1' },
  { name: 'restore preflight', handler: restore, method: 'POST', body: { history_id: requirementId }, rpc: 'get_assignment_doc_history_for_actor_v1' },
  { name: 'artifact put preflight', handler: artifactPut, method: 'PUT', body: { url: 'https://example.com' }, rpc: 'prepare_assignment_artifact_for_member_v1' },
  { name: 'artifact delete preflight', handler: artifactDelete, method: 'DELETE', rpc: 'prepare_assignment_artifact_for_member_v1' },
] as const

describe.each(cases)('shared admitted mounted route: $name', (testCase) => {
  const rpc = vi.fn()
  const from = vi.fn()
  function request() {
    return new NextRequest('http://localhost/api/shared-write-proof', {
      method: testCase.method,
      ...('body' in testCase ? { body: JSON.stringify(testCase.body) } : {}),
    })
  }
  function context() {
    return { params: Promise.resolve({ id: 'classroom' in testCase ? classroomId : assignmentId, requirementId, studentId }) }
  }

  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    vi.mocked(requireRole).mockRejectedValue(new Error('Legacy role path must not run'))
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Forbidden' } })
    from.mockImplementation((table: string) => {
      const query: any = {
        select: vi.fn(() => query), eq: vi.fn(() => query),
        single: vi.fn(async () => ({ data: {
          id: assignmentId, classroom_id: classroomId, is_draft: true,
          due_at: '2099-10-03T12:00:00Z', released_at: null,
          classrooms: { teacher_id: actorId, archived_at: null },
        }, error: null })),
        limit: vi.fn(async () => ({ data: [], error: null })),
        in: vi.fn(async () => ({ data: [{ student_id: studentId }], error: null })),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      }
      if (!['assignments', 'assignment_docs', 'classroom_enrollments', 'assignment_repo_targets'].includes(table)) throw new Error(`Unexpected discovery: ${table}`)
      return query
    })
    vi.mocked(getServiceRoleClient).mockReturnValue({ rpc, from } as any)
  })
  afterEach(() => vi.unstubAllEnvs())

  it.each(['teacher', 'student'] as const)('reaches only the actor-bound RPC for an admitted %s and retains its denial', async (role) => {
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role, email: 'actor@example.com' } as any)
    const response = await testCase.handler(request(), context())
    expect(response.status).toBe(403)
    expect(rpc).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledWith(testCase.rpc, expect.objectContaining({ p_actor_id: actorId }))
    expect(requireRole).not.toHaveBeenCalled()
    if (testCase.name === 'restore preflight') {
      expect(rpc).toHaveBeenCalledWith(testCase.rpc, expect.objectContaining({ p_member_only: true }))
    }
  })

  it('rejects malformed shared admission before body and database discovery', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', 'bad')
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role: 'teacher' } as any)
    const input = request()
    const json = vi.spyOn(input, 'json')
    expect((await testCase.handler(input, context())).status).toBe(503)
    expect(json).not.toHaveBeenCalled()
    expect(getServiceRoleClient).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
})
