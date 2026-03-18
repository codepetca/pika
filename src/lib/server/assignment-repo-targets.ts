import { ApiError } from '@/lib/api-handler'
import { extractAssignmentArtifacts, type AssignmentArtifact } from '@/lib/assignment-artifacts'
import { normalizeGitHubRepoUrl, parseGitHubRepoReference } from '@/lib/github-repos'
import { getServiceRoleClient } from '@/lib/supabase'
import type {
  AssignmentRepoTarget,
  AssignmentRepoTargetSelectionMode,
  AssignmentRepoTargetValidationStatus,
} from '@/types'

const GITHUB_API_BASE = 'https://api.github.com'

export interface ResolvedAssignmentRepoTarget {
  target: AssignmentRepoTarget | null
  candidateRepos: AssignmentArtifact[]
  effectiveRepoUrl: string | null
  repoOwner: string | null
  repoName: string | null
  selectionMode: AssignmentRepoTargetSelectionMode
  validationStatus: AssignmentRepoTargetValidationStatus
  validationMessage: string | null
}

function getGitHubToken(): string | null {
  const key = process.env.GITHUB_PAT?.trim() || process.env.GITHUB_FEEDBACK_TOKEN?.trim() || ''
  return key || null
}

export async function loadAssignmentRepoTarget(
  assignmentId: string,
  studentId: string,
): Promise<AssignmentRepoTarget | null> {
  const supabase = getServiceRoleClient()
  const { data, error } = await supabase
    .from('assignment_repo_targets')
    .select('*')
    .eq('assignment_id', assignmentId)
    .eq('student_id', studentId)
    .maybeSingle()

  if (error) {
    throw new ApiError(500, 'Failed to load repo target')
  }

  return data as AssignmentRepoTarget | null
}

export function extractRepoArtifactsFromContent(content: unknown): AssignmentArtifact[] {
  return extractAssignmentArtifacts(content).filter((artifact) => artifact.type === 'repo')
}

export function resolveAssignmentRepoTarget(opts: {
  candidateRepos: AssignmentArtifact[]
  target: AssignmentRepoTarget | null
}): ResolvedAssignmentRepoTarget {
  const candidateRepos = opts.candidateRepos
  const target = opts.target
  const normalizedCandidates = new Map(
    candidateRepos
      .map((artifact) => [artifact.normalized_url || normalizeGitHubRepoUrl(artifact.url), artifact] as const)
      .filter(([normalizedUrl]) => Boolean(normalizedUrl))
  )

  if (target?.selection_mode === 'teacher_override' && target.selected_repo_url) {
    return {
      target,
      candidateRepos,
      effectiveRepoUrl: target.selected_repo_url,
      repoOwner: target.repo_owner,
      repoName: target.repo_name,
      selectionMode: 'teacher_override',
      validationStatus: target.validation_status,
      validationMessage: target.validation_message,
    }
  }

  if (target?.selected_repo_url) {
    const normalizedTargetUrl = normalizeGitHubRepoUrl(target.selected_repo_url)
    if (normalizedTargetUrl && normalizedCandidates.has(normalizedTargetUrl)) {
      const artifact = normalizedCandidates.get(normalizedTargetUrl)!
      return {
        target,
        candidateRepos,
        effectiveRepoUrl: artifact.normalized_url || artifact.url,
        repoOwner: artifact.repo_owner || target.repo_owner,
        repoName: artifact.repo_name || target.repo_name,
        selectionMode: target.selection_mode,
        validationStatus: target.validation_status,
        validationMessage: target.validation_message,
      }
    }
  }

  if (candidateRepos.length === 0) {
    return {
      target,
      candidateRepos,
      effectiveRepoUrl: null,
      repoOwner: null,
      repoName: null,
      selectionMode: target?.selection_mode ?? 'auto',
      validationStatus: 'missing',
      validationMessage: 'No GitHub repo link detected in the submission.',
    }
  }

  if (candidateRepos.length > 1) {
    return {
      target,
      candidateRepos,
      effectiveRepoUrl: null,
      repoOwner: null,
      repoName: null,
      selectionMode: target?.selection_mode ?? 'auto',
      validationStatus: 'ambiguous',
      validationMessage: 'Multiple GitHub repo links were detected. Choose one repo to analyze.',
    }
  }

  const onlyRepo = candidateRepos[0]
  return {
    target,
    candidateRepos,
    effectiveRepoUrl: onlyRepo.normalized_url || onlyRepo.url,
    repoOwner: onlyRepo.repo_owner || null,
    repoName: onlyRepo.repo_name || null,
    selectionMode: target?.selection_mode ?? 'auto',
    validationStatus: target?.validation_status ?? 'valid',
    validationMessage: target?.validation_message ?? null,
  }
}

export async function validatePublicGitHubRepo(repoUrl: string): Promise<{
  repoUrl: string
  repoOwner: string
  repoName: string
  defaultBranch: string
  validationStatus: AssignmentRepoTargetValidationStatus
  validationMessage: string | null
}> {
  const parsed = parseGitHubRepoReference(repoUrl)
  if (!parsed) {
    return {
      repoUrl,
      repoOwner: '',
      repoName: '',
      defaultBranch: 'main',
      validationStatus: 'invalid',
      validationMessage: 'Repo URL must point to a GitHub repository.',
    }
  }

  const token = getGitHubToken()
  const res = await fetch(`${GITHUB_API_BASE}/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.name)}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: 'no-store',
  })

  if (res.status === 404 || res.status === 403) {
    return {
      repoUrl: parsed.normalizedUrl,
      repoOwner: parsed.owner,
      repoName: parsed.name,
      defaultBranch: 'main',
      validationStatus: 'inaccessible',
      validationMessage: 'Repo could not be accessed. Check that the repo exists and is public.',
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ApiError(500, `Failed to validate GitHub repo: ${text || res.statusText}`)
  }

  const data = await res.json() as { private?: boolean; default_branch?: string }
  if (data.private) {
    return {
      repoUrl: parsed.normalizedUrl,
      repoOwner: parsed.owner,
      repoName: parsed.name,
      defaultBranch: data.default_branch || 'main',
      validationStatus: 'private',
      validationMessage: 'Repo analysis only supports public GitHub repositories.',
    }
  }

  return {
    repoUrl: parsed.normalizedUrl,
    repoOwner: parsed.owner,
    repoName: parsed.name,
    defaultBranch: data.default_branch || 'main',
    validationStatus: 'valid',
    validationMessage: null,
  }
}

export async function saveAssignmentRepoTarget(opts: {
  assignmentId: string
  studentId: string
  repoUrl: string
  selectionMode: AssignmentRepoTargetSelectionMode
  validationStatus: AssignmentRepoTargetValidationStatus
  validationMessage: string | null
  repoOwner: string | null
  repoName: string | null
}): Promise<AssignmentRepoTarget> {
  const supabase = getServiceRoleClient()
  const { data, error } = await supabase
    .from('assignment_repo_targets')
    .upsert({
      assignment_id: opts.assignmentId,
      student_id: opts.studentId,
      selected_repo_url: opts.repoUrl,
      repo_owner: opts.repoOwner,
      repo_name: opts.repoName,
      selection_mode: opts.selectionMode,
      validation_status: opts.validationStatus,
      validation_message: opts.validationMessage,
      validated_at: new Date().toISOString(),
    }, { onConflict: 'assignment_id,student_id' })
    .select('*')
    .single()

  if (error || !data) {
    throw new ApiError(500, 'Failed to save repo target')
  }

  return data as AssignmentRepoTarget
}

