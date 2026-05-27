import { describe, expect, it } from 'vitest'
import {
  getSubmissionRequirementCompletion,
  normalizeAssignmentSubmissionRequirementDrafts,
  submissionArtifactsToAssignmentArtifacts,
} from '@/lib/assignment-submission-requirements'
import type {
  AssignmentSubmissionArtifact,
  AssignmentSubmissionRequirement,
} from '@/types'

function requirement(
  overrides: Partial<AssignmentSubmissionRequirement>
): AssignmentSubmissionRequirement {
  return {
    id: overrides.id ?? 'req-1',
    assignment_id: 'assignment-1',
    type: overrides.type ?? 'link',
    label: overrides.label ?? 'Public link',
    instructions: overrides.instructions ?? '',
    required: overrides.required ?? true,
    position: overrides.position ?? 0,
    validation_policy_json: {},
    created_at: overrides.created_at ?? '2026-05-01T00:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-05-01T00:00:00.000Z',
  }
}

function artifact(
  overrides: Partial<AssignmentSubmissionArtifact>
): AssignmentSubmissionArtifact {
  return {
    id: overrides.id ?? 'artifact-1',
    assignment_doc_id: 'doc-1',
    requirement_id: overrides.requirement_id ?? 'req-1',
    student_id: 'student-1',
    type: overrides.type ?? 'link',
    url: overrides.url ?? 'https://example.com',
    storage_path: overrides.storage_path ?? null,
    metadata_json: overrides.metadata_json ?? {},
    validation_status: overrides.validation_status ?? 'valid',
    validation_message: overrides.validation_message ?? null,
    validated_at: overrides.validated_at ?? '2026-05-01T00:00:00.000Z',
    created_at: overrides.created_at ?? '2026-05-01T00:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-05-01T00:00:00.000Z',
  }
}

describe('normalizeAssignmentSubmissionRequirementDrafts', () => {
  it('defaults labels, required state, instructions, and positions', () => {
    expect(normalizeAssignmentSubmissionRequirementDrafts([
      { type: 'repo_link' },
      { type: 'image', label: '  Homepage screenshot  ', required: false, instructions: '  Upload PNG  ' },
    ])).toEqual([
      {
        id: undefined,
        type: 'repo_link',
        label: 'Repo link',
        instructions: '',
        required: true,
        position: 0,
        validation_policy_json: {},
      },
      {
        id: undefined,
        type: 'image',
        label: 'Homepage screenshot',
        instructions: 'Upload PNG',
        required: false,
        position: 1,
        validation_policy_json: {},
      },
    ])
  })
})

describe('getSubmissionRequirementCompletion', () => {
  it('blocks submit when a required artifact is missing', () => {
    const completion = getSubmissionRequirementCompletion([
      requirement({ id: 'req-1', required: true }),
      requirement({ id: 'req-2', required: false, position: 1 }),
    ], [
      artifact({ requirement_id: 'req-2', validation_status: 'valid' }),
    ])

    expect(completion.requiredCount).toBe(1)
    expect(completion.completedRequiredCount).toBe(0)
    expect(completion.canSubmit).toBe(false)
    expect(completion.missingRequiredRequirementIds).toEqual(['req-1'])
  })

  it('blocks invalid and inaccessible artifacts', () => {
    const inaccessibleCompletion = getSubmissionRequirementCompletion([
      requirement({ id: 'req-1' }),
    ], [
      artifact({ requirement_id: 'req-1', validation_status: 'inaccessible' }),
    ])

    expect(inaccessibleCompletion.canSubmit).toBe(false)
    expect(inaccessibleCompletion.blockingRequirementIds).toEqual(['req-1'])

    const invalidCompletion = getSubmissionRequirementCompletion([
      requirement({ id: 'req-1' }),
    ], [
      artifact({ requirement_id: 'req-1', validation_status: 'invalid' }),
    ])

    expect(invalidCompletion.canSubmit).toBe(false)
    expect(invalidCompletion.blockingRequirementIds).toEqual(['req-1'])
  })
})

describe('submissionArtifactsToAssignmentArtifacts', () => {
  it('maps structured artifacts into existing teacher artifact display objects', () => {
    expect(submissionArtifactsToAssignmentArtifacts([
      artifact({
        type: 'repo_link',
        url: 'https://github.com/codepetca/pika',
        metadata_json: {
          repo_owner: 'codepetca',
          repo_name: 'pika',
          normalized_url: 'https://github.com/codepetca/pika',
        },
      }),
      artifact({
        id: 'artifact-2',
        requirement_id: 'req-2',
        type: 'image',
        url: 'https://signed.example.com/image.png',
        storage_path: 'student-1/assignment-1/image.png',
      }),
    ])).toEqual([
      {
        type: 'repo',
        url: 'https://github.com/codepetca/pika',
        title: 'Repo link',
        is_required_submission: true,
        requirement_id: 'req-1',
        requirement_required: true,
        repo_owner: 'codepetca',
        repo_name: 'pika',
        normalized_url: 'https://github.com/codepetca/pika',
      },
      {
        type: 'image',
        url: 'https://signed.example.com/image.png',
        title: 'Screenshot',
        is_required_submission: true,
        requirement_id: 'req-2',
        requirement_required: true,
      },
    ])
  })

  it('uses requirement labels for teacher artifact display metadata', () => {
    expect(submissionArtifactsToAssignmentArtifacts([
      artifact({
        requirement_id: 'req-demo',
        type: 'link',
        url: 'https://demo.example.com',
      }),
    ], [
      requirement({
        id: 'req-demo',
        type: 'link',
        label: 'Published demo',
        required: false,
      }),
    ])).toEqual([
      {
        type: 'link',
        url: 'https://demo.example.com',
        title: 'Published demo',
        is_required_submission: false,
        requirement_id: 'req-demo',
        requirement_required: false,
      },
    ])
  })
})
