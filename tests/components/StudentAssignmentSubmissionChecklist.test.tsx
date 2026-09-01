import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  StudentAssignmentSubmissionChecklist,
  type StudentAssignmentSubmissionChecklistHandle,
} from '@/components/StudentAssignmentSubmissionChecklist'
import type {
  AssignmentSubmissionArtifact,
  AssignmentSubmissionRequirement,
} from '@/types'

afterEach(() => {
  vi.unstubAllGlobals()
})

function requirement(
  overrides: Partial<AssignmentSubmissionRequirement>
): AssignmentSubmissionRequirement {
  return {
    id: overrides.id ?? 'req-link',
    assignment_id: 'assignment-1',
    type: overrides.type ?? 'link',
    label: overrides.label ?? 'CodeHS public view',
    instructions: overrides.instructions ?? '',
    required: overrides.required ?? true,
    position: overrides.position ?? 0,
    validation_policy_json: overrides.validation_policy_json ?? {},
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
  }
}

function artifact(
  overrides: Partial<AssignmentSubmissionArtifact>
): AssignmentSubmissionArtifact {
  return {
    id: overrides.id ?? 'artifact-1',
    assignment_doc_id: 'doc-1',
    requirement_id: overrides.requirement_id ?? 'req-link',
    student_id: 'student-1',
    type: overrides.type ?? 'link',
    url: overrides.url ?? 'https://codehs.com/sandbox/example',
    storage_path: overrides.storage_path ?? null,
    metadata_json: overrides.metadata_json ?? {},
    validation_status: overrides.validation_status ?? 'valid',
    validation_message: overrides.validation_message ?? null,
    validated_at: '2026-06-01T00:00:00.000Z',
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
  }
}

describe('StudentAssignmentSubmissionChecklist', () => {
  it('uses the teacher label and generic URL copy for link requirements', () => {
    render(
      <StudentAssignmentSubmissionChecklist
        assignmentId="assignment-1"
        requirements={[requirement({})]}
        artifacts={[artifact({
          metadata_json: { validation_level: 'format_only' },
        })]}
        githubIdentity={null}
        onArtifactsChange={vi.fn()}
        onError={vi.fn()}
      />
    )

    expect(screen.getByText('CodeHS public view')).toBeInTheDocument()
    expect(screen.getByLabelText('URL')).toBeInTheDocument()
    expect(screen.queryByLabelText('Public URL')).not.toBeInTheDocument()
    expect(screen.getByText('Saved')).toBeInTheDocument()
  })

  it('disables saving an unchanged link until the student edits it', () => {
    render(
      <StudentAssignmentSubmissionChecklist
        assignmentId="assignment-1"
        requirements={[requirement({})]}
        artifacts={[artifact({})]}
        githubIdentity={null}
        onArtifactsChange={vi.fn()}
        onError={vi.fn()}
      />
    )

    const urlInput = screen.getByLabelText('URL')
    const saveButton = screen.getByRole('button', { name: 'Save' })

    expect(saveButton).toBeDisabled()

    fireEvent.change(urlInput, { target: { value: 'https://codehs.com/sandbox/updated' } })

    expect(saveButton).toBeEnabled()
  })

  it('enables saving a repo link when the GitHub username changes', () => {
    render(
      <StudentAssignmentSubmissionChecklist
        assignmentId="assignment-1"
        requirements={[requirement({
          type: 'repo_link',
          label: 'Project repo',
        })]}
        artifacts={[artifact({
          type: 'repo_link',
          metadata_json: { github_login: 'saved-user' },
        })]}
        githubIdentity={{ github_id: 1234, github_login: 'saved-user' }}
        onArtifactsChange={vi.fn()}
        onError={vi.fn()}
      />
    )

    const githubInput = screen.getByLabelText('GitHub username')
    const saveButton = screen.getByRole('button', { name: 'Save' })

    expect(saveButton).toBeDisabled()

    fireEvent.change(githubInput, { target: { value: 'updated-user' } })

    expect(saveButton).toBeEnabled()
  })

  it('shows policy warning results as needs review without removing the saved URL', () => {
    render(
      <StudentAssignmentSubmissionChecklist
        assignmentId="assignment-1"
        requirements={[requirement({})]}
        artifacts={[artifact({
          validation_status: 'warning',
          validation_message: 'This page may require login.',
          metadata_json: { validation_level: 'review' },
        })]}
        githubIdentity={null}
        onArtifactsChange={vi.fn()}
        onError={vi.fn()}
      />
    )

    expect(screen.getByText('Needs review')).toBeInTheDocument()
    expect(screen.getByText('This page may require login.')).toBeInTheDocument()
    expect(screen.getByDisplayValue('https://codehs.com/sandbox/example')).toBeInTheDocument()
  })

  it('saves pending URL edits before the parent checks for missing attachments', async () => {
    const nextArtifact = artifact({ url: 'https://example.com/final' })
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ artifact: nextArtifact }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const ref = createRef<StudentAssignmentSubmissionChecklistHandle>()
    const onArtifactsChange = vi.fn()

    render(
      <StudentAssignmentSubmissionChecklist
        ref={ref}
        assignmentId="assignment-1"
        requirements={[requirement({})]}
        artifacts={[artifact({})]}
        githubIdentity={null}
        onArtifactsChange={onArtifactsChange}
        onError={vi.fn()}
      />
    )

    fireEvent.change(screen.getByLabelText('URL'), {
      target: { value: 'https://example.com/final' },
    })

    let savedArtifacts: AssignmentSubmissionArtifact[] = []
    await act(async () => {
      savedArtifacts = await ref.current!.savePendingArtifacts()
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/assignment-docs/assignment-1/artifacts/req-link',
      expect.objectContaining({ method: 'PUT' })
    )
    expect(savedArtifacts).toContainEqual(nextArtifact)
    await waitFor(() => expect(onArtifactsChange).toHaveBeenCalledWith(expect.arrayContaining([nextArtifact])))
  })
})
