'use client'

import { ChangeEvent, forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
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

export interface StudentAssignmentSubmissionChecklistHandle {
  savePendingArtifacts: () => Promise<AssignmentSubmissionArtifact[]>
}

type DraftState = Record<string, { url: string; githubLogin: string }>

function RequirementIcon({ type }: { type: AssignmentSubmissionRequirement['type'] }) {
  if (type === 'repo_link') return <FolderGit2 className="h-4 w-4" aria-hidden="true" />
  if (type === 'image') return <Camera className="h-4 w-4" aria-hidden="true" />
  return <Link2 className="h-4 w-4" aria-hidden="true" />
}

function StatusIcon({ item }: { item: ReturnType<typeof getSubmissionRequirementCompletion>['items'][number] }) {
  if (item.artifact?.validation_status === 'pending') {
    return <Loader2 className="h-4 w-4 animate-spin text-text-muted" aria-hidden="true" />
  }
  if (item.isPresent && item.artifact?.validation_status === 'valid') {
    return <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
  }
  if (item.isPresent && !item.artifact?.validation_status) {
    return <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
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

function normalizeDraftValue(value: string | null | undefined) {
  return (value ?? '').trim()
}

export const StudentAssignmentSubmissionChecklist = forwardRef<StudentAssignmentSubmissionChecklistHandle, StudentAssignmentSubmissionChecklistProps>(function StudentAssignmentSubmissionChecklist({
  assignmentId,
  requirements,
  artifacts,
  githubIdentity,
  disabled = false,
  onArtifactsChange,
  onError,
}, ref) {
  const [drafts, setDrafts] = useState<DraftState>(() => buildDraftState(requirements, artifacts, githubIdentity))
  const [savingRequirementId, setSavingRequirementId] = useState<string | null>(null)
  const [failedImageRequirementIds, setFailedImageRequirementIds] = useState<Set<string>>(() => new Set())
  const failedImageRequirementIdsRef = useRef(new Set<string>())
  const pendingImageUploadsRef = useRef(new Map<string, Promise<void>>())
  const uploadedImageArtifactsRef = useRef(new Map<string, AssignmentSubmissionArtifact>())

  useEffect(() => {
    setDrafts(buildDraftState(requirements, artifacts, githubIdentity))
  }, [artifacts, githubIdentity, requirements])

  const completion = useMemo(
    () => getSubmissionRequirementCompletion(requirements, artifacts),
    [artifacts, requirements]
  )

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

  function replaceArtifactInList(
    currentArtifacts: AssignmentSubmissionArtifact[],
    nextArtifact: AssignmentSubmissionArtifact
  ) {
    const filtered = currentArtifacts.filter((artifact) => artifact.requirement_id !== nextArtifact.requirement_id)
    return [...filtered, nextArtifact]
  }

  async function persistUrlArtifact(requirement: AssignmentSubmissionRequirement) {
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
      return data.artifact as AssignmentSubmissionArtifact
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save attachment'
      onError(message)
      throw new Error(message)
    } finally {
      setSavingRequirementId(null)
    }
  }

  async function saveUrlArtifact(requirement: AssignmentSubmissionRequirement) {
    try {
      const nextArtifact = await persistUrlArtifact(requirement)
      onArtifactsChange(replaceArtifactInList(artifacts, nextArtifact))
    } catch {
      // The shared error region already explains why the save stopped.
    }
  }

  useImperativeHandle(ref, () => ({
    async savePendingArtifacts() {
      let nextArtifacts = artifacts

      await Promise.all(pendingImageUploadsRef.current.values())
      for (const uploadedArtifact of uploadedImageArtifactsRef.current.values()) {
        nextArtifacts = replaceArtifactInList(nextArtifacts, uploadedArtifact)
      }
      if (failedImageRequirementIdsRef.current.size > 0) {
        throw new Error('Retry the failed image upload or choose to continue without it.')
      }

      for (const requirement of requirements) {
        if (requirement.type === 'image') continue
        const draft = drafts[requirement.id] ?? { url: '', githubLogin: '' }
        const savedArtifact = nextArtifacts.find((artifact) => artifact.requirement_id === requirement.id)
        const savedGithubLogin =
          typeof savedArtifact?.metadata_json?.github_login === 'string'
            ? savedArtifact.metadata_json.github_login
            : githubIdentity?.github_login ?? ''
        const hasChanges =
          normalizeDraftValue(draft.url) !== normalizeDraftValue(savedArtifact?.url) ||
          (requirement.type === 'repo_link' &&
            normalizeDraftValue(draft.githubLogin) !== normalizeDraftValue(savedGithubLogin))

        if (!hasChanges) continue
        const nextArtifact = await persistUrlArtifact(requirement)
        nextArtifacts = replaceArtifactInList(nextArtifacts, nextArtifact)
        onArtifactsChange(nextArtifacts)
      }

      return nextArtifacts
    },
  }))

  if (requirements.length === 0) return null

  function uploadImageArtifact(requirement: AssignmentSubmissionRequirement, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const input = event.target

    setSavingRequirementId(requirement.id)
    failedImageRequirementIdsRef.current.delete(requirement.id)
    setFailedImageRequirementIds((current) => {
      const next = new Set(current)
      next.delete(requirement.id)
      return next
    })
    onError('')

    const upload = (async () => {
      try {
        const formData = new FormData()
        formData.append('file', file)
        const response = await fetch(`/api/assignment-docs/${assignmentId}/artifacts/${requirement.id}`, {
          method: 'POST',
          body: formData,
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Failed to upload image')
        const nextArtifact = data.artifact as AssignmentSubmissionArtifact
        uploadedImageArtifactsRef.current.set(requirement.id, nextArtifact)
        let nextArtifacts = artifacts
        for (const uploadedArtifact of uploadedImageArtifactsRef.current.values()) {
          nextArtifacts = replaceArtifactInList(nextArtifacts, uploadedArtifact)
        }
        onArtifactsChange(nextArtifacts)
      } catch (error) {
        failedImageRequirementIdsRef.current.add(requirement.id)
        setFailedImageRequirementIds((current) => new Set(current).add(requirement.id))
        onError(error instanceof Error ? error.message : 'Failed to upload image')
      } finally {
        input.value = ''
        setSavingRequirementId((current) => current === requirement.id ? null : current)
      }
    })()

    pendingImageUploadsRef.current.set(requirement.id, upload)
    void upload.finally(() => {
      if (pendingImageUploadsRef.current.get(requirement.id) === upload) {
        pendingImageUploadsRef.current.delete(requirement.id)
      }
    })
  }

  function dismissFailedImageUpload(requirementId: string) {
    failedImageRequirementIdsRef.current.delete(requirementId)
    setFailedImageRequirementIds((current) => {
      const next = new Set(current)
      next.delete(requirementId)
      return next
    })
    onError('')
  }

  return (
    <div className="rounded-card border border-border bg-surface-panel shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-text-default">Turn in</h3>
          <p className="text-xs text-text-muted">
            {completion.completedRequiredCount} of {completion.requiredCount} added
          </p>
        </div>
      </div>

      <div className="divide-y divide-border">
        {completion.items.map((item) => {
          const requirement = item.requirement
          const draft = drafts[requirement.id] ?? { url: '', githubLogin: '' }
          const isSaving = savingRequirementId === requirement.id
          const savedGithubLogin =
            typeof item.artifact?.metadata_json?.github_login === 'string'
              ? item.artifact.metadata_json.github_login
              : githubIdentity?.github_login ?? ''
          const hasChanges =
            normalizeDraftValue(draft.url) !== normalizeDraftValue(item.artifact?.url) ||
            (requirement.type === 'repo_link' &&
              normalizeDraftValue(draft.githubLogin) !== normalizeDraftValue(savedGithubLogin))

          return (
            <div key={requirement.id} className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
              <div className="flex min-w-0 items-start gap-2">
                <span className="mt-0.5 text-text-muted">
                  <RequirementIcon type={requirement.type} />
                </span>
                <div className="min-w-0">
                  <span className="block truncate text-sm font-medium text-text-default">{requirement.label}</span>
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
                  {failedImageRequirementIds.has(requirement.id) ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={disabled || isSaving}
                      onClick={() => dismissFailedImageUpload(requirement.id)}
                    >
                      {item.isPresent ? 'Keep current image' : 'Continue without image'}
                    </Button>
                  ) : null}
                </div>
              ) : (
                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                  <div className={requirement.type === 'repo_link' ? 'grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(9rem,0.35fr)]' : ''}>
                    <FormField label={requirement.type === 'repo_link' ? 'Repository URL' : 'URL'}>
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
                      disabled={disabled || isSaving || !hasChanges}
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
})
