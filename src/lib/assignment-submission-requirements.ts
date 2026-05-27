import type {
  AssignmentSubmissionArtifact,
  AssignmentSubmissionRequirement,
  AssignmentSubmissionRequirementType,
} from '@/types'
import type { AssignmentArtifact } from '@/lib/assignment-artifacts'

export const ASSIGNMENT_SUBMISSION_REQUIREMENT_TYPES: AssignmentSubmissionRequirementType[] = [
  'repo_link',
  'link',
  'image',
]

export const DEFAULT_REQUIREMENT_LABELS: Record<AssignmentSubmissionRequirementType, string> = {
  repo_link: 'Repo link',
  link: 'Public link',
  image: 'Screenshot',
}

export type AssignmentSubmissionRequirementDraft = {
  id?: string
  type: AssignmentSubmissionRequirementType
  label?: string | null
  instructions?: string | null
  required?: boolean | null
  position?: number | null
  validation_policy_json?: Record<string, unknown> | null
}

export type SubmissionRequirementCompletionItem = {
  requirement: AssignmentSubmissionRequirement
  artifact: AssignmentSubmissionArtifact | null
  isPresent: boolean
  isBlocking: boolean
  statusLabel: string
}

export type SubmissionRequirementCompletion = {
  requiredCount: number
  completedRequiredCount: number
  missingRequiredRequirementIds: string[]
  blockingRequirementIds: string[]
  canSubmit: boolean
  items: SubmissionRequirementCompletionItem[]
}

export function isAssignmentSubmissionRequirementType(
  value: unknown
): value is AssignmentSubmissionRequirementType {
  return typeof value === 'string' && ASSIGNMENT_SUBMISSION_REQUIREMENT_TYPES.includes(value as AssignmentSubmissionRequirementType)
}

export function normalizeAssignmentSubmissionRequirementDrafts(
  drafts: AssignmentSubmissionRequirementDraft[]
): AssignmentSubmissionRequirementDraft[] {
  return drafts
    .filter((draft) => isAssignmentSubmissionRequirementType(draft.type))
    .map((draft, index) => {
      const label = draft.label?.trim() || DEFAULT_REQUIREMENT_LABELS[draft.type]
      const position = Number.isInteger(draft.position) ? Number(draft.position) : index

      return {
        id: draft.id,
        type: draft.type,
        label,
        instructions: draft.instructions?.trim() || '',
        required: draft.required !== false,
        position,
        validation_policy_json: draft.validation_policy_json ?? {},
      }
    })
}

export function isSubmissionArtifactPresent(
  artifact: AssignmentSubmissionArtifact | null | undefined
): boolean {
  if (!artifact) return false

  if (artifact.type === 'image') {
    return Boolean(artifact.storage_path || artifact.url)
  }

  return Boolean(artifact.url?.trim())
}

export function isSubmissionArtifactBlocking(
  artifact: AssignmentSubmissionArtifact | null | undefined
): boolean {
  if (!artifact) return true
  if (!isSubmissionArtifactPresent(artifact)) return true
  return artifact.validation_status === 'invalid' || artifact.validation_status === 'inaccessible'
}

export function getSubmissionArtifactStatusLabel(
  artifact: AssignmentSubmissionArtifact | null | undefined
): string {
  if (!artifact || !isSubmissionArtifactPresent(artifact)) return 'Missing'

  switch (artifact.validation_status) {
    case 'valid':
      return 'Checked'
    case 'warning':
      return 'Warning'
    case 'inaccessible':
      return 'Needs review'
    case 'pending':
      return 'Checking'
    case 'invalid':
      return 'Fix needed'
    default:
      return 'Added'
  }
}

export function getSubmissionRequirementCompletion(
  requirements: AssignmentSubmissionRequirement[],
  artifacts: AssignmentSubmissionArtifact[]
): SubmissionRequirementCompletion {
  const artifactByRequirementId = new Map(
    artifacts.map((artifact) => [artifact.requirement_id, artifact])
  )
  const missingRequiredRequirementIds: string[] = []
  const blockingRequirementIds: string[] = []
  let requiredCount = 0
  let completedRequiredCount = 0

  const items = requirements
    .slice()
    .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at))
    .map((requirement) => {
      const artifact = artifactByRequirementId.get(requirement.id) ?? null
      const isPresent = isSubmissionArtifactPresent(artifact)
      const isBlocking = isSubmissionArtifactBlocking(artifact)

      if (requirement.required) {
        requiredCount += 1
        if (isPresent && !isBlocking) {
          completedRequiredCount += 1
        } else if (!isPresent) {
          missingRequiredRequirementIds.push(requirement.id)
        }
      }

      if (isBlocking && (requirement.required || isPresent)) {
        blockingRequirementIds.push(requirement.id)
      }

      return {
        requirement,
        artifact,
        isPresent,
        isBlocking,
        statusLabel: getSubmissionArtifactStatusLabel(artifact),
      }
    })

  return {
    requiredCount,
    completedRequiredCount,
    missingRequiredRequirementIds,
    blockingRequirementIds,
    canSubmit: missingRequiredRequirementIds.length === 0 && blockingRequirementIds.length === 0,
    items,
  }
}

function getRequirementArtifactFields(
  artifact: AssignmentSubmissionArtifact,
  requirement?: AssignmentSubmissionRequirement | null
) {
  return {
    title: requirement?.label?.trim() || DEFAULT_REQUIREMENT_LABELS[artifact.type],
    is_required_submission: requirement?.required ?? true,
    requirement_id: artifact.requirement_id,
    requirement_required: requirement?.required ?? true,
  }
}

export function submissionArtifactToAssignmentArtifact(
  artifact: AssignmentSubmissionArtifact,
  requirement?: AssignmentSubmissionRequirement | null
): AssignmentArtifact | null {
  const url = artifact.url?.trim()
  if (!url) return null
  const requirementFields = getRequirementArtifactFields(artifact, requirement)

  if (artifact.type === 'image') {
    return { type: 'image', url, ...requirementFields }
  }

  if (artifact.type === 'repo_link') {
    const repoOwner = typeof artifact.metadata_json?.repo_owner === 'string'
      ? artifact.metadata_json.repo_owner
      : undefined
    const repoName = typeof artifact.metadata_json?.repo_name === 'string'
      ? artifact.metadata_json.repo_name
      : undefined
    const normalizedUrl = typeof artifact.metadata_json?.normalized_url === 'string'
      ? artifact.metadata_json.normalized_url
      : undefined
    const githubUsername = typeof artifact.metadata_json?.github_login === 'string'
      ? artifact.metadata_json.github_login
      : undefined

    return {
      type: 'repo',
      url,
      ...requirementFields,
      repo_owner: repoOwner,
      repo_name: repoName,
      normalized_url: normalizedUrl,
      github_username: githubUsername,
    }
  }

  return { type: 'link', url, ...requirementFields }
}

export function submissionArtifactsToAssignmentArtifacts(
  artifacts: AssignmentSubmissionArtifact[],
  requirements: AssignmentSubmissionRequirement[] = []
): AssignmentArtifact[] {
  const requirementsById = new Map(requirements.map((requirement) => [requirement.id, requirement]))

  return artifacts
    .map((artifact) => submissionArtifactToAssignmentArtifact(
      artifact,
      requirementsById.get(artifact.requirement_id) ?? null
    ))
    .filter((artifact): artifact is AssignmentArtifact => artifact !== null)
}
