import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getContextualAssignmentDocHistory,
  restoreContextualAssignmentDoc,
} from '@/lib/server/contextual-assignment-doc-history'

const actorId = '11111111-1111-4111-8111-111111111111'
const assignmentId = '22222222-2222-4222-8222-222222222222'
const classroomId = '33333333-3333-4333-8333-333333333333'
const docId = '44444444-4444-4444-8444-444444444444'
const historyId = '55555555-5555-4555-8555-555555555555'
const saveSessionId = '66666666-6666-4666-8666-666666666666'
const metricSessionId = '77777777-7777-4777-8777-777777777777'
const revision = '2026-09-20T12:00:00.000Z'
const beforeContent = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Before' }] }],
}
const restoredContent = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Restored' }] }],
}

function historyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: historyId,
    assignment_doc_id: docId,
    patch: null,
    snapshot: restoredContent,
    word_count: 1,
    char_count: 8,
    paste_word_count: 0,
    keystroke_count: 0,
    trigger: 'baseline',
    created_at: revision,
    ...overrides,
  }
}

function historyDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: docId,
    assignment_id: assignmentId,
    student_id: actorId,
    content: beforeContent,
    is_submitted: false,
    updated_at: revision,
    ...overrides,
  }
}

function documentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: docId,
    assignment_id: assignmentId,
    student_id: actorId,
    content: restoredContent,
    content_legacy: '',
    is_submitted: false,
    submitted_at: null,
    created_at: revision,
    updated_at: revision,
    viewed_at: revision,
    score_completion: null,
    score_thinking: null,
    score_workflow: null,
    feedback: null,
    feedback_returned_at: null,
    graded_at: null,
    graded_by: null,
    returned_at: null,
    teacher_cleared_at: null,
    teacher_feedback_draft: null,
    teacher_feedback_draft_updated_at: null,
    ai_feedback_suggestion: null,
    ai_feedback_suggested_at: null,
    ai_feedback_model: null,
    authenticity_score: null,
    authenticity_flags: null,
    repo_url: null,
    github_username: null,
    save_session_id: saveSessionId,
    save_sequence: 1,
    ...overrides,
  }
}

function readResult(overrides: Record<string, unknown> = {}) {
  return {
    access_mode: 'member',
    assignment: { id: assignmentId, classroom_id: classroomId },
    subject_id: actorId,
    doc: historyDoc(),
    history: [historyRow()],
    ...overrides,
  }
}

describe('contextual assignment document history and restore', () => {
  const rpc = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    rpc.mockResolvedValue({ data: readResult(), error: null })
  })

  it('loads member-own history through the locked service boundary', async () => {
    await expect(getContextualAssignmentDocHistory({
      supabase: { rpc } as any,
      actorId,
      assignmentId,
      memberOnly: true,
    })).resolves.toMatchObject({
      accessMode: 'member',
      classroomId,
      subjectId: actorId,
      doc: { id: docId },
      history: [{ id: historyId }],
    })
    expect(rpc).toHaveBeenCalledWith('get_assignment_doc_history_for_actor_v1', {
      p_actor_id: actorId,
      p_assignment_id: assignmentId,
      p_member_only: true,
    })
  })

  it('binds owner history to the requested enrolled student', async () => {
    rpc.mockResolvedValue({ data: readResult({ access_mode: 'owner' }), error: null })
    await expect(getContextualAssignmentDocHistory({
      supabase: { rpc } as any,
      actorId: '88888888-8888-4888-8888-888888888888',
      assignmentId,
      requestedStudentId: actorId,
    })).resolves.toMatchObject({ accessMode: 'owner', subjectId: actorId })
  })

  it.each([
    readResult({ assignment: { id: docId, classroom_id: classroomId } }),
    readResult({ subject_id: docId }),
    readResult({ doc: historyDoc({ assignment_id: docId }) }),
    readResult({ doc: historyDoc({ student_id: docId }) }),
    readResult({ history: [historyRow({ assignment_doc_id: historyId })] }),
    readResult({ doc: null }),
    { ...readResult(), unexpected: true },
  ])('fails closed on malformed or substituted history evidence %#', async (data) => {
    rpc.mockResolvedValue({ data, error: null })
    await expect(getContextualAssignmentDocHistory({
      supabase: { rpc } as any,
      actorId,
      assignmentId,
    })).rejects.toMatchObject({ statusCode: 503 })
  })

  it('rejects owner evidence from a member-only read', async () => {
    rpc.mockResolvedValue({ data: readResult({ access_mode: 'owner' }), error: null })
    await expect(getContextualAssignmentDocHistory({
      supabase: { rpc } as any,
      actorId,
      assignmentId,
      memberOnly: true,
    })).rejects.toMatchObject({ statusCode: 503 })
  })

  it('restores only the exact actor, assignment, history target and revision', async () => {
    rpc.mockResolvedValue({
      data: {
        ok: true,
        created: false,
        doc: documentRow(),
        history_entry: historyRow({ trigger: 'restore' }),
        classroom_id: classroomId,
      },
      error: null,
    })
    await expect(restoreContextualAssignmentDoc({
      supabase: { rpc } as any,
      actorId,
      assignmentId,
      historyId,
      previousContent: beforeContent,
      content: restoredContent,
      expectedUpdatedAt: revision,
      saveSessionId,
      saveSequence: 1,
      metricSessionId,
    })).resolves.toMatchObject({ ok: true, classroomId, doc: { id: docId } })
    expect(rpc).toHaveBeenCalledWith('restore_assignment_doc_for_member_v1', expect.objectContaining({
      p_actor_id: actorId,
      p_assignment_id: assignmentId,
      p_history_id: historyId,
      p_content: restoredContent,
      p_expected_updated_at: revision,
      p_save_session_id: saveSessionId,
      p_save_sequence: 1,
      p_metric_session_id: metricSessionId,
      p_word_count: 1,
      p_char_count: 8,
    }))
  })

  it('preserves established atomic restore conflicts', async () => {
    rpc.mockResolvedValue({
      data: {
        ok: false,
        status: 409,
        error_code: 'assignment_doc_revision_conflict',
        error: 'Reload and review the latest version.',
        classroom_id: classroomId,
      },
      error: null,
    })
    await expect(restoreContextualAssignmentDoc({
      supabase: { rpc } as any,
      actorId,
      assignmentId,
      historyId,
      previousContent: beforeContent,
      content: restoredContent,
      expectedUpdatedAt: revision,
      saveSessionId,
      saveSequence: 1,
      metricSessionId,
    })).resolves.toMatchObject({
      ok: false,
      status: 409,
      errorCode: 'assignment_doc_revision_conflict',
      classroomId,
    })
  })

  it.each([
    ['P0002', 404],
    ['42501', 403],
    ['22023', 400],
    ['40001', 409],
    ['40P01', 409],
    ['55P03', 409],
    ['PGRST202', 503],
    ['08006', 503],
  ])('maps restore RPC %s to %i without leaking database details', async (code, statusCode) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: 'private database detail' } })
    const operation = restoreContextualAssignmentDoc({
      supabase: { rpc } as any,
      actorId,
      assignmentId,
      historyId,
      previousContent: beforeContent,
      content: restoredContent,
      expectedUpdatedAt: revision,
      saveSessionId,
      saveSequence: 1,
      metricSessionId,
    })
    await expect(operation).rejects.toMatchObject({ statusCode })
    await expect(operation).rejects.not.toThrow('private database detail')
  })

  it.each([
    null,
    { ok: true, created: false, doc: documentRow({ assignment_id: docId }), history_entry: null, classroom_id: classroomId },
    { ok: true, created: false, doc: documentRow({ student_id: docId }), history_entry: null, classroom_id: classroomId },
    { ok: true, created: false, doc: documentRow(), history_entry: historyRow({ assignment_doc_id: historyId }), classroom_id: classroomId },
    { ok: true, created: false, doc: documentRow(), history_entry: null, classroom_id: docId, extra: true },
  ])('fails closed on invalid restore evidence %#', async (data) => {
    rpc.mockResolvedValue({ data, error: null })
    await expect(restoreContextualAssignmentDoc({
      supabase: { rpc } as any,
      actorId,
      assignmentId,
      historyId,
      previousContent: beforeContent,
      content: restoredContent,
      expectedUpdatedAt: revision,
      saveSessionId,
      saveSequence: 1,
      metricSessionId,
    })).rejects.toMatchObject({ statusCode: 503 })
  })
})
