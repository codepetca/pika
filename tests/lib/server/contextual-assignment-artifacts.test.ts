import { describe, expect, it, vi } from 'vitest'

import {
  deleteContextualAssignmentArtifact,
  prepareContextualAssignmentArtifact,
  upsertContextualAssignmentArtifact,
} from '@/lib/server/contextual-assignment-artifacts'

const actorId = '11111111-1111-4111-8111-111111111111'
const assignmentId = '22222222-2222-4222-8222-222222222222'
const classroomId = '33333333-3333-4333-8333-333333333333'
const requirementId = '44444444-4444-4444-8444-444444444444'
const assignmentDocId = '55555555-5555-4555-8555-555555555555'
const artifactId = '66666666-6666-4666-8666-666666666666'
const timestamp = '2026-09-20T14:00:00.000Z'

const requirement = {
  id: requirementId,
  artifact_id: '77777777-7777-4777-8777-777777777777',
  source_artifact_id: null,
  source_blueprint_version_id: null,
  assignment_id: assignmentId,
  type: 'link',
  label: 'Evidence',
  instructions: '',
  required: false,
  position: 0,
  validation_policy_json: {},
  created_at: timestamp,
  updated_at: timestamp,
}
const artifact = {
  id: artifactId,
  assignment_doc_id: assignmentDocId,
  requirement_id: requirementId,
  student_id: actorId,
  type: 'link',
  url: 'https://example.com/work',
  storage_path: null,
  metadata_json: {},
  validation_status: 'valid',
  validation_message: null,
  validated_at: timestamp,
  created_at: timestamp,
  updated_at: timestamp,
}

describe('contextual assignment artifact adapter', () => {
  it('accepts exact preflight evidence and rejects foreign artifact evidence', async () => {
    const rpc = vi.fn(async () => ({
      data: {
        ok: true,
        classroom_id: classroomId,
        assignment_doc_id: assignmentDocId,
        requirement,
        artifact,
      },
      error: null,
    }))
    await expect(prepareContextualAssignmentArtifact({
      supabase: { rpc }, actorId, assignmentId, requirementId,
    })).resolves.toMatchObject({
      ok: true,
      classroomId,
      assignmentDocId,
      requirement: { id: requirementId },
      artifact: { student_id: actorId },
    })

    rpc.mockResolvedValueOnce({
      data: {
        ok: true,
        classroom_id: classroomId,
        assignment_doc_id: assignmentDocId,
        requirement,
        artifact: { ...artifact, student_id: classroomId },
      },
      error: null,
    })
    await expect(prepareContextualAssignmentArtifact({
      supabase: { rpc }, actorId, assignmentId, requirementId,
    })).rejects.toMatchObject({ statusCode: 503 })
  })

  it('sends identity and managed evidence through the atomic upsert boundary', async () => {
    const rpc = vi.fn(async () => ({
      data: {
        ok: true,
        classroom_id: classroomId,
        artifact,
        previous_storage_path: null,
      },
      error: null,
    }))
    await expect(upsertContextualAssignmentArtifact({
      supabase: { rpc },
      actorId,
      assignmentId,
      requirementId,
      type: 'link',
      url: artifact.url,
      storagePath: null,
      metadata: {},
      validationStatus: 'valid',
      validationMessage: null,
      validatedAt: timestamp,
      managedObjectId: null,
      githubIdentity: {
        login: 'codepetca',
        validationStatus: 'valid',
        validationMessage: null,
      },
    })).resolves.toMatchObject({ ok: true, artifact: { id: artifactId } })
    expect(rpc).toHaveBeenCalledWith(
      'upsert_assignment_artifact_for_member_v1',
      expect.objectContaining({
        p_actor_id: actorId,
        p_assignment_id: assignmentId,
        p_requirement_id: requirementId,
        p_save_github_identity: true,
        p_github_login: 'codepetca',
      }),
    )
  })

  it('preserves submitted-document deletion errors without issuing cleanup evidence', async () => {
    const rpc = vi.fn(async () => ({
      data: {
        ok: false,
        status: 409,
        error_code: 'assignment_doc_submitted',
        error: 'Cannot edit a submitted document',
      },
      error: null,
    }))
    await expect(deleteContextualAssignmentArtifact({
      supabase: { rpc }, actorId, assignmentId, requirementId,
    })).resolves.toEqual({
      ok: false,
      status: 409,
      errorCode: 'assignment_doc_submitted',
      error: 'Cannot edit a submitted document',
    })
  })

  it('maps current-membership denial and contention to stable API errors', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'Forbidden' } })
      .mockResolvedValueOnce({ data: null, error: { code: '40001', message: 'Assignment binding changed' } })

    await expect(prepareContextualAssignmentArtifact({
      supabase: { rpc }, actorId, assignmentId, requirementId,
    })).rejects.toMatchObject({ statusCode: 403 })
    await expect(prepareContextualAssignmentArtifact({
      supabase: { rpc }, actorId, assignmentId, requirementId,
    })).rejects.toMatchObject({ statusCode: 409 })
  })
})
