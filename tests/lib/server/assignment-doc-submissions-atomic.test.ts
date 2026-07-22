import { describe, expect, it, vi } from 'vitest'
import {
  saveAssignmentDocAtomic,
  submitAssignmentDocAtomic,
  unsubmitAssignmentDocAtomic,
} from '@/lib/server/assignment-doc-submissions'

const beforeContent = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Before' }] }],
}
const afterContent = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'After' }] }],
}

function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    assignment_id: 'assignment-1',
    student_id: 'student-1',
    content: afterContent,
    content_legacy: '',
    is_submitted: false,
    submitted_at: null,
    created_at: '2026-07-16T12:00:00.000Z',
    updated_at: '2026-07-16T12:01:00.000Z',
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
    save_session_id: '10000000-0000-4000-8000-000000000001',
    save_sequence: 1,
    ...overrides,
  }
}

describe('atomic assignment document operations', () => {
  it('passes revision, history, and metric-session evidence to the save RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ok: true,
        created: false,
        doc: makeDoc(),
        history_entry: null,
      },
      error: null,
    })

    const result = await saveAssignmentDocAtomic({
      supabase: { rpc },
      assignmentId: 'assignment-1',
      studentId: 'student-1',
      previousContent: beforeContent,
      content: afterContent,
      expectedUpdatedAt: '2026-07-16T12:00:00.000Z',
      trigger: 'blur',
      pasteWordCount: 2,
      keystrokeCount: 7,
      saveSessionId: '10000000-0000-4000-8000-000000000001',
      saveSequence: 2,
      metricSessionId: '10000000-0000-4000-8000-000000000009',
    })

    expect(result.ok).toBe(true)
    expect(rpc).toHaveBeenCalledWith('save_assignment_doc_atomic', expect.objectContaining({
      p_assignment_id: 'assignment-1',
      p_student_id: 'student-1',
      p_expected_updated_at: '2026-07-16T12:00:00.000Z',
      p_trigger: 'blur',
      p_paste_word_count: 2,
      p_keystroke_count: 7,
      p_save_session_id: '10000000-0000-4000-8000-000000000001',
      p_save_sequence: 2,
      p_metric_session_id: '10000000-0000-4000-8000-000000000009',
      p_patch: expect.any(Array),
      p_word_count: 1,
      p_char_count: 5,
    }))
  })

  it('preserves structured conflicts returned by the save RPC', async () => {
    const result = await saveAssignmentDocAtomic({
      supabase: {
        rpc: vi.fn().mockResolvedValue({
          data: {
            ok: false,
            status: 409,
            error_code: 'assignment_doc_revision_required',
            error: 'A saved draft revision is required. Reload and try again.',
          },
          error: null,
        }),
      },
      assignmentId: 'assignment-1',
      studentId: 'student-1',
      previousContent: beforeContent,
      content: afterContent,
      expectedUpdatedAt: null,
      trigger: 'autosave',
      pasteWordCount: 0,
      keystrokeCount: 0,
      saveSessionId: '10000000-0000-4000-8000-000000000001',
      saveSequence: 1,
      metricSessionId: '10000000-0000-4000-8000-000000000002',
    })

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'A saved draft revision is required. Reload and try again.',
      errorCode: 'assignment_doc_revision_required',
    })
  })

  it('returns the submitted document from the atomic submit RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ok: true,
        idempotent: false,
        doc: makeDoc({ is_submitted: true, submitted_at: '2026-07-16T12:02:00.000Z' }),
        history_entry: {
          id: 'history-1',
          assignment_doc_id: 'doc-1',
          patch: null,
          snapshot: afterContent,
          word_count: 1,
          char_count: 5,
          paste_word_count: 0,
          keystroke_count: 0,
          trigger: 'submit',
          created_at: '2026-07-16T12:02:00.000Z',
        },
      },
      error: null,
    })

    const result = await submitAssignmentDocAtomic({
      supabase: { rpc },
      assignmentId: 'assignment-1',
      studentId: 'student-1',
      content: afterContent,
      expectedUpdatedAt: '2026-07-16T12:01:00.000Z',
    })

    expect(result.ok).toBe(true)
    expect(rpc).toHaveBeenCalledWith('submit_assignment_doc_atomic', expect.objectContaining({
      p_expected_updated_at: '2026-07-16T12:01:00.000Z',
      p_word_count: 1,
      p_char_count: 5,
    }))
  })

  it('accepts production-shaped authenticity flags from every mutation RPC', async () => {
    const flaggedDoc = makeDoc({
      authenticity_flags: [{
        timestamp: '2026-07-16T12:01:00.000Z',
        wordDelta: 12,
        seconds: 2,
        wps: 6,
        reason: 'high_wps',
      }],
    })
    const rpc = vi.fn(async (name: string) => {
      if (name === 'save_assignment_doc_atomic') {
        return { data: { ok: true, created: false, doc: flaggedDoc, history_entry: null }, error: null }
      }
      if (name === 'submit_assignment_doc_atomic') {
        return { data: { ok: true, idempotent: false, doc: flaggedDoc, history_entry: null }, error: null }
      }
      return { data: { ok: true, doc: flaggedDoc }, error: null }
    })

    const saved = await saveAssignmentDocAtomic({
      supabase: { rpc },
      assignmentId: 'assignment-1',
      studentId: 'student-1',
      previousContent: beforeContent,
      content: afterContent,
      expectedUpdatedAt: '2026-07-16T12:00:00.000Z',
      trigger: 'autosave',
      pasteWordCount: 0,
      keystrokeCount: 1,
      saveSessionId: '10000000-0000-4000-8000-000000000001',
      saveSequence: 2,
      metricSessionId: '10000000-0000-4000-8000-000000000002',
    })
    const submitted = await submitAssignmentDocAtomic({
      supabase: { rpc },
      assignmentId: 'assignment-1',
      studentId: 'student-1',
      content: afterContent,
      expectedUpdatedAt: '2026-07-16T12:01:00.000Z',
    })
    const unsubmitted = await unsubmitAssignmentDocAtomic({
      supabase: { rpc },
      assignmentId: 'assignment-1',
      studentId: 'student-1',
    })

    expect(saved.ok).toBe(true)
    expect(submitted.ok).toBe(true)
    expect(unsubmitted.ok).toBe(true)
  })

  it('accepts and strips additive RPC fields during migration-first rollout', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ok: true,
        created: false,
        future_envelope_field: 'new-server-metadata',
        doc: makeDoc({ future_doc_field: 'new-column' }),
        history_entry: null,
      },
      error: null,
    })

    const result = await saveAssignmentDocAtomic({
      supabase: { rpc },
      assignmentId: 'assignment-1',
      studentId: 'student-1',
      previousContent: beforeContent,
      content: afterContent,
      expectedUpdatedAt: '2026-07-16T12:00:00.000Z',
      trigger: 'autosave',
      pasteWordCount: 0,
      keystrokeCount: 1,
      saveSessionId: '10000000-0000-4000-8000-000000000001',
      saveSequence: 2,
      metricSessionId: '10000000-0000-4000-8000-000000000002',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.doc).not.toHaveProperty('future_doc_field')
  })

  it('reports a missing atomic migration without falling back to split writes', async () => {
    const result = await submitAssignmentDocAtomic({
      supabase: {
        rpc: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202' } }),
      },
      assignmentId: 'assignment-1',
      studentId: 'student-1',
      content: afterContent,
      expectedUpdatedAt: '2026-07-16T12:01:00.000Z',
    })

    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'Assignment submission migration is required',
      errorCode: 'assignment_submission_migration_required',
    })
  })

  it('returns a structured conflict when atomic unsubmit loses to teacher return', async () => {
    const result = await unsubmitAssignmentDocAtomic({
      supabase: {
        rpc: vi.fn().mockResolvedValue({
          data: {
            ok: false,
            status: 409,
            error_code: 'assignment_doc_returned',
            error: 'Returned submissions cannot be unsubmitted',
          },
          error: null,
        }),
      },
      assignmentId: 'assignment-1',
      studentId: 'student-1',
    })

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'Returned submissions cannot be unsubmitted',
      errorCode: 'assignment_doc_returned',
    })
  })

  it('rejects malformed RPC documents instead of casting them into the domain', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await submitAssignmentDocAtomic({
      supabase: {
        rpc: vi.fn().mockResolvedValue({
          data: {
            ok: true,
            idempotent: false,
            doc: makeDoc({ content: { invalid: true }, updated_at: 'not-a-timestamp' }),
            history_entry: null,
          },
          error: null,
        }),
      },
      assignmentId: 'assignment-1',
      studentId: 'student-1',
      content: afterContent,
      expectedUpdatedAt: '2026-07-16T12:01:00.000Z',
    })

    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'Assignment document operation failed',
      errorCode: 'invalid_rpc_result',
    })
    expect(consoleError).toHaveBeenCalled()
  })

  it('rejects malformed JSON Patch history returned by the RPC', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await submitAssignmentDocAtomic({
      supabase: {
        rpc: vi.fn().mockResolvedValue({
          data: {
            ok: true,
            idempotent: false,
            doc: makeDoc({ is_submitted: true, submitted_at: '2026-07-16T12:02:00.000Z' }),
            history_entry: {
              id: 'history-1',
              assignment_doc_id: 'doc-1',
              patch: [{ op: 'replace', path: '/content', unexpected: true }],
              snapshot: null,
              word_count: 1,
              char_count: 5,
              paste_word_count: 0,
              keystroke_count: 0,
              trigger: 'submit',
              created_at: '2026-07-16T12:02:00.000Z',
            },
          },
          error: null,
        }),
      },
      assignmentId: 'assignment-1',
      studentId: 'student-1',
      content: afterContent,
      expectedUpdatedAt: '2026-07-16T12:01:00.000Z',
    })

    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'Assignment document operation failed',
      errorCode: 'invalid_rpc_result',
    })
    expect(consoleError).toHaveBeenCalled()
  })
})
