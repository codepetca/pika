'use client'

import { ChangeEvent, useEffect, useMemo, useState } from 'react'
import { AlertCircle, Camera, CheckCircle2, FolderGit2, Link2, Loader2, Upload } from 'lucide-react'
import { Button, FormField, Input } from '@/ui'
import {
  getSubmissionRequirementCompletion,
} from '@/lib/assignment-submission-requirements'
import type {
  AssignmentSubmissionArtifact,
  AssignmentSubmissionRequirement,
  UserGitHubIdentity,
} from '@/types'

interface StudentAssignmentSubmissionChecklistProps {
  assignmentId: string
  requirements: AssignmentSubmissionRequirement[]
  artifacts: AssignmentSubmissionArtifact[]
  githubIdentity: UserGitHubIdentity | null
  disabled?: boolean
  onArtifactsChange: (artifacts: AssignmentSubmissionArtifact[]) => void
  onError: (message: string) => void
}

type DraftState = Record<string, { url: string; githubLogin: string }>

function RequirementIcon({ type }: { type: AssignmentSubmissionRequirement['type'] }) {
  if (type === 'repo_link') return <FolderGit2 className="h-4 w-4" aria-hidden="true" />
  if (type === 'image') return <Camera className="h-4 w-4" aria-hidden="true" />
  return <Link2 className="h-4 w-4" aria-hidden="true" />
}

function StatusIcon({ item }: { item: ReturnType<typeof getSubmissionRequirementCompletion>['items'][number] }) {
  if (item.isPresent && !item.isBlocking) {
    return <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
  }
  if (item.artifact?.validation_status === 'pending') {
    return <Loader2 className="h-4 w-4 animate-spin text-text-muted" aria-hidden="true" />
  }
  return <AlertCircle className="h-4 w-4 text-warning" aria-hidden="true" />
}

function buildDraftState(
  requirements: AssignmentSubmissionRequirement[],
  artifacts: AssignmentSubmissionArtifact[],
  githubIdentity: UserGitHubIdentity | null
): DraftState {
  const artifactByRequirementId = new Map(artifacts.map((artifact) => [artifact.requirement_id, artifact]))
  const next: DraftState = {}

  for (const requirement of requirements) {
    const artifact = artifactByRequirementId.get(requirement.id)
    next[requirement.id] = {
      url: artifact?.url ?? '',
      githubLogin:
        typeof artifact?.metadata_json?.github_login === 'string'
          ? artifact.metadata_json.github_login
          : githubIdentity?.github_login ?? '',
    }
  }

  return next
}

export function StudentAssignmentSubmissionChecklist({
  assignmentId,
  requirements,
  artifacts,
  githubIdentity,
  disabled = false,
  onArtifactsChange,
  onError,
}: StudentAssignmentSubmissionChecklistProps) {
  const [drafts, setDrafts] = useState<DraftState>(() => buildDraftState(requirements, artifacts, githubIdentity))
  const [savingRequirementId, setSavingRequirementId] = useState<string | null>(null)

  useEffect(() => {
    setDrafts(buildDraftState(requirements, artifacts, githubIdentity))
  }, [artifacts, githubIdentity, requirements])

  const completion = useMemo(
    () => getSubmissionRequirementCompletion(requirements, artifacts),
    [artifacts, requirements]
  )

  if (requirements.length === 0) return null

  function updateDraft(requirementId: string, patch: Partial<DraftState[string]>) {
    setDrafts((current) => ({
      ...current,
      [requirementId]: {
        url: current[requirementId]?.url ?? '',
        githubLogin: current[requirementId]?.githubLogin ?? '',
        ...patch,
      },
    }))
  }

  function replaceArtifact(nextArtifact: AssignmentSubmissionArtifact) {
    const filtered = artifacts.filter((artifact) => artifact.requirement_id !== nextArtifact.requirement_id)
    onArtifactsChange([...filtered, nextArtifact])
  }

  async function saveUrlArtifact(requirement: AssignmentSubmissionRequirement) {
    const draft = drafts[requirement.id] ?? { url: '', githubLogin: '' }
    setSavingRequirementId(requirement.id)
    onError('')

    try {
      const response = await fetch(`/api/assignment-docs/${assignmentId}/artifacts/${requirement.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: draft.url,
          github_login: draft.githubLogin,
          save_github_login: requirement.type === 'repo_link',
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to save submission')
      replaceArtifact(data.artifact)
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to save submission')
    } finally {
      setSavingRequirementId(null)
    }
  }

  async function uploadImageArtifact(requirement: AssignmentSubmissionRequirement, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setSavingRequirementId(requirement.id)
    onError('')

    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch(`/api/assignment-docs/${assignmentId}/artifacts/${requirement.id}`, {
        method: 'POST',
        body: formData,
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to upload image')
      replaceArtifact(data.artifact)
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to upload image')
    } finally {
      event.target.value = ''
      setSavingRequirementId(null)
    }
  }

  return (
    <div className="rounded-card border border-border bg-surface-panel shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-text-default">Turn in</h3>
          <p className="text-xs text-text-muted">
            {completion.completedRequiredCount}/{completion.requiredCount} required complete
          </p>
        </div>
      </div>

      <div className="divide-y divide-border">
        {completion.items.map((item) => {
          const requirement = item.requirement
          const draft = drafts[requirement.id] ?? { url: '', githubLogin: '' }
          const isSaving = savingRequirementId === requirement.id

          return (
            <div key={requirement.id} className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
              <div className="flex min-w-0 items-start gap-2">
                <span className="mt-0.5 text-text-muted">
                  <RequirementIcon type={requirement.type} />
                </span>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium text-text-default">{requirement.label}</span>
                    {requirement.required ? (
                      <span className="shrink-0 rounded-badge bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-muted">
                        Required
                      </span>
                    ) : null}
                  </div>
                  {requirement.instructions ? (
                    <p className="mt-0.5 text-xs text-text-muted">{requirement.instructions}</p>
                  ) : null}
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-text-muted">
                    <StatusIcon item={item} />
                    <span>{item.statusLabel}</span>
                  </div>
                </div>
              </div>

              {requirement.type === 'image' ? (
                <div className="flex flex-wrap items-center gap-3">
                  {item.artifact?.url ? (
                    <div
                      className="h-20 w-28 rounded-md border border-border bg-surface-2 bg-contain bg-center bg-no-repeat"
                      style={{ backgroundImage: `url("${encodeURI(item.artifact.url)}")` }}
                    />
                  ) : null}
                  <label className="inline-flex">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp"
                      className="sr-only"
                      disabled={disabled || isSaving}
                      onChange={(event) => uploadImageArtifact(requirement, event)}
                    />
                    <span className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-text-default hover:bg-surface-hover">
                      <Upload className="h-4 w-4" aria-hidden="true" />
                      {isSaving ? 'Uploading...' : item.isPresent ? 'Replace' : 'Upload'}
                    </span>
                  </label>
                </div>
              ) : (
                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                  <div className={requirement.type === 'repo_link' ? 'grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(9rem,0.35fr)]' : ''}>
                    <FormField label={requirement.type === 'repo_link' ? 'Repository URL' : 'Public URL'}>
                      <Input
                        value={draft.url}
                        disabled={disabled || isSaving}
                        placeholder={requirement.type === 'repo_link' ? 'https://github.com/owner/repo' : 'https://example.com'}
                        onChange={(event) => updateDraft(requirement.id, { url: event.target.value })}
                      />
                    </FormField>
                    {requirement.type === 'repo_link' ? (
                      <FormField label="GitHub username">
                        <Input
                          value={draft.githubLogin}
                          disabled={disabled || isSaving}
                          placeholder="username"
                          onChange={(event) => updateDraft(requirement.id, { githubLogin: event.target.value })}
                        />
                      </FormField>
                    ) : null}
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={disabled || isSaving}
                      onClick={() => saveUrlArtifact(requirement)}
                    >
                      {isSaving ? 'Saving...' : 'Save'}
                    </Button>
                  </div>
                </div>
              )}

              {item.artifact?.validation_message ? (
                <p className="lg:col-start-2 text-xs text-warning">{item.artifact.validation_message}</p>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
