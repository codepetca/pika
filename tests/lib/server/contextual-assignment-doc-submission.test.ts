import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  assertContextualAssignmentSubmissionResourceEvidence,
  prepareContextualAssignmentDocSubmission,
  submitContextualAssignmentDoc,
  unsubmitContextualAssignmentDoc,
  verifyContextualAssignmentSubmissionAssignmentEvidence,
  verifyContextualAssignmentSubmissionDocEvidence,
} from '@/lib/server/contextual-assignment-doc-submission'

const actorId = '11111111-1111-4111-8111-111111111111'
const assignmentId = '22222222-2222-4222-8222-222222222222'
const classroomId = '33333333-3333-4333-8333-333333333333'
const docId = '44444444-4444-4444-8444-444444444444'
const requirementId = '55555555-5555-4555-8555-555555555555'
const artifactId = '66666666-6666-4666-8666-666666666666'
const revision = '2026-09-20T12:00:00.000Z'
const content = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Submitted' }] }],
}

function documentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: docId,
    assignment_id: assignmentId,
    student_id: actorId,
    content,
    content_legacy: '',
    is_submitted: true,
    submitted_at: revision,
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
    save_session_id: null,
    save_sequence: null,
    ...overrides,
  }
}

function preflightDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: docId,
    assignment_id: assignmentId,
    student_id: actorId,
    content,
    is_submitted: false,
    submitted_at: null,
    updated_at: revision,
    returned_at: null,
    teacher_cleared_at: null,
    ...overrides,
  }
}

function requirementRow(overrides: Record<string, unknown> = {}) {
  return {
    id: requirementId,
    artifact_id: artifactId,
    source_artifact_id: null,
    source_blueprint_version_id: null,
    assignment_id: assignmentId,
    type: 'link',
    label: 'Source',
    instructions: '',
    required: true,
    position: 0,
    validation_policy_json: {},
    created_at: revision,
    updated_at: revision,
    ...overrides,
  }
}

function artifactRow(overrides: Record<string, unknown> = {}) {
  return {
    id: artifactId,
    assignment_doc_id: docId,
    requirement_id: requirementId,
    student_id: actorId,
    type: 'link',
    url: 'https://example.invalid/work',
    storage_path: null,
    metadata_json: {},
    validation_status: 'valid',
    validation_message: null,
    validated_at: revision,
    created_at: revision,
    updated_at: revision,
    ...overrides,
  }
}

describe('contextual assignment document submission', () => {
  const rpc = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    rpc.mockResolvedValue({
      data: {
        ok: true,
        idempotent: false,
        doc: documentRow(),
        history_entry: null,
        classroom_id: classroomId,
      },
      error: null,
    })
  })

  it('binds the trusted member, revision, acknowledgement set, and Pal mode to submit', async () => {
    await expect(submitContextualAssignmentDoc({
      supabase: { rpc },
      actorId,
      assignmentId,
      content,
      expectedUpdatedAt: revision,
      acknowledgedMissingRequirementIds: [requirementId],
      palEvent: null,
    })).resolves.toMatchObject({
      ok: true,
      doc: { id: docId },
      classroomId,
      idempotent: false,
    })
    expect(rpc).toHaveBeenCalledWith('submit_assignment_doc_for_member_v1', {
      p_actor_id: actorId,
      p_assignment_id: assignmentId,
      p_content: content,
      p_expected_updated_at: revision,
      p_word_count: 1,
      p_char_count: 9,
      p_acknowledged_missing_requirement_ids: [requirementId],
      p_emit_pal_event: true,
      p_pal_event: null,
    })
  })

  it('binds contextual unsubmit to the authenticated member', async () => {
    rpc.mockResolvedValue({
      data: {
        ok: true,
        doc: documentRow({ is_submitted: false, submitted_at: null }),
        classroom_id: classroomId,
      },
      error: null,
    })
    await expect(unsubmitContextualAssignmentDoc({
      supabase: { rpc }, actorId, assignmentId,
    })).resolves.toMatchObject({ ok: true, classroomId, doc: { is_submitted: false } })
    expect(rpc).toHaveBeenCalledWith('unsubmit_assignment_doc_for_member_v1', {
      p_actor_id: actorId,
      p_assignment_id: assignmentId,
    })
  })

  it('loads submit preflight evidence only through the member transaction', async () => {
    rpc.mockResolvedValue({
      data: {
        assignment: { id: assignmentId, classroom_id: classroomId, due_at: null },
        doc: preflightDocument(),
        submission_requirements: [requirementRow()],
        submission_artifacts: [artifactRow()],
      },
      error: null,
    })

    await expect(prepareContextualAssignmentDocSubmission({
      supabase: { rpc }, actorId, assignmentId,
    })).resolves.toMatchObject({
      assignment: { id: assignmentId, classroom_id: classroomId },
      doc: { id: docId, student_id: actorId },
      submissionRequirements: [{ id: requirementId }],
      submissionArtifacts: [{ id: artifactId }],
    })
    expect(rpc).toHaveBeenCalledWith('prepare_assignment_doc_submission_for_member_v1', {
      p_actor_id: actorId,
      p_assignment_id: assignmentId,
    })
  })

  it.each([
    ['assignment_submission_requirements_missing', 409],
    ['assignment_submission_requirements_incomplete', 400],
  ])('preserves the %s attachment race result', async (message, status) => {
    rpc.mockResolvedValue({ data: null, error: { code: '23514', message } })
    await expect(submitContextualAssignmentDoc({
      supabase: { rpc }, actorId, assignmentId, content, expectedUpdatedAt: revision,
    })).resolves.toMatchObject({ ok: false, status, errorCode: message })
  })

  it.each([
    ['P0002', 404],
    ['42501', 403],
    ['22023', 400],
    ['40001', 409],
    ['40P01', 409],
    ['55000', 409],
    ['55P03', 409],
    ['PGRST202', 503],
    ['42883', 503],
    ['08006', 503],
  ])('maps RPC %s to %i without leaking database details', async (code, statusCode) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: 'private database detail' } })
    const operation = submitContextualAssignmentDoc({
      supabase: { rpc }, actorId, assignmentId, content, expectedUpdatedAt: revision,
    })
    await expect(operation).rejects.toMatchObject({ statusCode })
    await expect(operation).rejects.not.toThrow('private database detail')
  })

  it.each([
    null,
    { ok: true, idempotent: false, doc: documentRow({ assignment_id: docId }), history_entry: null, classroom_id: classroomId },
    { ok: true, idempotent: false, doc: documentRow({ student_id: docId }), history_entry: null, classroom_id: classroomId },
    { ok: true, idempotent: false, doc: documentRow(), history_entry: null, classroom_id: docId, extra: true },
  ])('fails closed on invalid submit evidence %#', async (data) => {
    rpc.mockResolvedValue({ data, error: null })
    await expect(submitContextualAssignmentDoc({
      supabase: { rpc }, actorId, assignmentId, content, expectedUpdatedAt: revision,
    })).rejects.toMatchObject({ statusCode: 503 })
  })

  it('canonicalizes and binds bounded preflight evidence', () => {
    expect(verifyContextualAssignmentSubmissionAssignmentEvidence({
      assignmentId: assignmentId.toUpperCase(),
      rows: [{ id: assignmentId, classroom_id: classroomId, due_at: null }],
    })).toMatchObject({ id: assignmentId, classroom_id: classroomId })
    expect(verifyContextualAssignmentSubmissionDocEvidence({
      actorId: actorId.toUpperCase(),
      assignmentId: assignmentId.toUpperCase(),
      rows: [{
        id: docId,
        assignment_id: assignmentId,
        student_id: actorId,
        content,
        is_submitted: false,
        submitted_at: null,
        updated_at: revision,
        returned_at: null,
        teacher_cleared_at: null,
      }],
    })).toMatchObject({ id: docId, student_id: actorId })
  })

  it('rejects substituted requirement and artifact evidence', () => {
    expect(() => assertContextualAssignmentSubmissionResourceEvidence({
      actorId,
      assignmentId,
      assignmentDocId: docId,
      requirements: [requirementRow() as any],
      artifacts: [artifactRow({ requirement_id: artifactId }) as any],
    })).toThrow(expect.objectContaining({ statusCode: 503 }))
  })

  it.each([
    { doc: preflightDocument({ student_id: docId }) },
    { submission_requirements: [requirementRow({ assignment_id: docId })] },
    { submission_artifacts: [artifactRow({ student_id: docId })] },
    { submission_artifacts: [artifactRow({ type: 'image' })] },
  ])('fails closed on substituted preflight evidence %#', async (override) => {
    rpc.mockResolvedValue({
      data: {
        assignment: { id: assignmentId, classroom_id: classroomId, due_at: null },
        doc: preflightDocument(),
        submission_requirements: [requirementRow()],
        submission_artifacts: [artifactRow()],
        ...override,
      },
      error: null,
    })
    await expect(prepareContextualAssignmentDocSubmission({
      supabase: { rpc }, actorId, assignmentId,
    })).rejects.toMatchObject({ statusCode: 503 })
  })
})
