import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  saveContextualAssignmentDoc,
  verifyContextualAssignmentDocSaveEvidence,
} from '@/lib/server/contextual-assignment-doc-save'

const actorId = '11111111-1111-4111-8111-111111111111'
const assignmentId = '22222222-2222-4222-8222-222222222222'
const docId = '33333333-3333-4333-8333-333333333333'
const historyId = '44444444-4444-4444-8444-444444444444'
const saveSessionId = '55555555-5555-4555-8555-555555555555'
const metricSessionId = '66666666-6666-4666-8666-666666666666'
const beforeContent = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Before' }] }],
}
const content = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'After' }] }],
}

function documentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: docId,
    assignment_id: assignmentId,
    student_id: actorId,
    content,
    content_legacy: '',
    is_submitted: false,
    submitted_at: null,
    created_at: '2026-09-19T12:00:00.000Z',
    updated_at: '2026-09-19T12:01:00.000Z',
    viewed_at: null,
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
    save_sequence: 2,
    ...overrides,
  }
}

function save(rpc: ReturnType<typeof vi.fn>) {
  return saveContextualAssignmentDoc({
    supabase: { rpc },
    actorId,
    assignmentId,
    previousContent: beforeContent,
    content,
    expectedUpdatedAt: '2026-09-19T12:00:00.000Z',
    trigger: 'blur',
    pasteWordCount: 2,
    keystrokeCount: 7,
    saveSessionId,
    saveSequence: 2,
    metricSessionId,
  })
}

describe('contextual assignment document save', () => {
  const rpc = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    rpc.mockResolvedValue({
      data: { ok: true, created: false, doc: documentRow(), history_entry: null },
      error: null,
    })
  })

  it('binds the trusted actor, assignment, revision, history, and metrics to the RPC', async () => {
    await expect(save(rpc)).resolves.toMatchObject({ ok: true, doc: { id: docId } })
    expect(rpc).toHaveBeenCalledWith('save_assignment_doc_for_member_v1', expect.objectContaining({
      p_actor_id: actorId,
      p_assignment_id: assignmentId,
      p_expected_updated_at: '2026-09-19T12:00:00.000Z',
      p_trigger: 'blur',
      p_paste_word_count: 2,
      p_keystroke_count: 7,
      p_save_session_id: saveSessionId,
      p_save_sequence: 2,
      p_metric_session_id: metricSessionId,
      p_patch: expect.any(Array),
      p_word_count: 1,
      p_char_count: 5,
    }))
  })

  it('preserves established structured save conflicts', async () => {
    rpc.mockResolvedValue({
      data: {
        ok: false,
        status: 409,
        error_code: 'assignment_doc_revision_conflict',
        error: 'Reload and review the latest version.',
      },
      error: null,
    })
    await expect(save(rpc)).resolves.toEqual({
      ok: false,
      status: 409,
      errorCode: 'assignment_doc_revision_conflict',
      error: 'Reload and review the latest version.',
    })
  })

  it.each([
    ['P0002', 404],
    ['42501', 403],
    ['22023', 400],
    ['40001', 409],
    ['55000', 409],
    ['PGRST202', 503],
    ['42883', 503],
    ['08006', 503],
  ])('maps RPC %s to %i without leaking database details', async (code, statusCode) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: 'private database detail' } })
    const operation = save(rpc)
    await expect(operation).rejects.toMatchObject({ statusCode })
    await expect(operation).rejects.not.toThrow('private database detail')
  })

  it.each([
    null,
    { ok: true, created: false, doc: documentRow({ assignment_id: docId }), history_entry: null },
    { ok: true, created: false, doc: documentRow({ student_id: docId }), history_entry: null },
    {
      ok: true,
      created: false,
      doc: documentRow(),
      history_entry: {
        id: historyId,
        assignment_doc_id: historyId,
        patch: null,
        snapshot: content,
        word_count: 1,
        char_count: 5,
        paste_word_count: 0,
        keystroke_count: 1,
        trigger: 'autosave',
        created_at: '2026-09-19T12:01:00.000Z',
      },
    },
    { ok: true, created: false, doc: documentRow(), history_entry: null, unexpected: true },
  ])('fails closed on invalid database evidence %#', async (data) => {
    rpc.mockResolvedValue({ data, error: null })
    await expect(save(rpc)).rejects.toMatchObject({ statusCode: 503 })
  })

  it('rejects malformed trusted identity before the RPC', async () => {
    await expect(saveContextualAssignmentDoc({
      supabase: { rpc },
      actorId: 'not-a-uuid',
      assignmentId,
      previousContent: beforeContent,
      content,
      expectedUpdatedAt: null,
      trigger: 'autosave',
      pasteWordCount: 0,
      keystrokeCount: 0,
      saveSessionId,
      saveSequence: 1,
      metricSessionId,
    })).rejects.toMatchObject({ statusCode: 400 })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('canonicalizes and binds a bounded existing-document preflight', () => {
    expect(verifyContextualAssignmentDocSaveEvidence({
      actorId: actorId.toUpperCase(),
      assignmentId: assignmentId.toUpperCase(),
      rows: [{
        id: docId,
        assignment_id: assignmentId,
        student_id: actorId,
        is_submitted: false,
        content: JSON.stringify(beforeContent),
        updated_at: '2026-09-19T12:00:00.000Z',
      }],
    })).toMatchObject({ content: beforeContent, assignment_id: assignmentId, student_id: actorId })
  })

  it.each([
    null,
    [{ id: docId, assignment_id: assignmentId, student_id: actorId }],
    [{
      id: docId,
      assignment_id: assignmentId,
      student_id: actorId,
      is_submitted: false,
      content: 'not-json',
      updated_at: '2026-09-19T12:00:00.000Z',
    }],
    [{
      id: docId,
      assignment_id: assignmentId,
      student_id: actorId,
      is_submitted: false,
      content: beforeContent,
      updated_at: '2026-09-19T12:00:00.000Z',
      unexpected: true,
    }],
  ])('fails closed on malformed preflight evidence %#', (rows) => {
    expect(() => verifyContextualAssignmentDocSaveEvidence({
      actorId,
      assignmentId,
      rows,
    })).toThrow(expect.objectContaining({ statusCode: 503 }))
  })
})
