import {
  normalizeAssignmentSubmissionRequirementDrafts,
  type AssignmentSubmissionRequirementDraft,
} from '@/lib/assignment-submission-requirements'
import type {
  AssignmentSubmissionArtifact,
  AssignmentSubmissionRequirement,
} from '@/types'

const ASSIGNMENT_ARTIFACTS_BUCKET = 'assignment-artifacts'
const SIGNED_IMAGE_URL_EXPIRES_SECONDS = 60 * 60
const STORAGE_REMOVE_CHUNK_SIZE = 1000

type SupabaseClientLike = any
type SupabaseSchemaError = {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
}

export function isMissingAssignmentSubmissionSchemaError(error: unknown): error is SupabaseSchemaError {
  if (!error || typeof error !== 'object') return false

  const record = error as SupabaseSchemaError
  if (record.code === 'PGRST205' || record.code === 'PGRST204' || record.code === '42P01') {
    return true
  }

  const combined = `${record.message ?? ''} ${record.details ?? ''} ${record.hint ?? ''}`.toLowerCase()
  return (
    combined.includes('assignment_submission_requirements') ||
    combined.includes('assignment_submission_artifacts') ||
    combined.includes('user_github_identities') ||
    combined.includes('replace_assignment_submission_requirements_atomic')
  )
}

async function signArtifactImageUrls(
  supabase: SupabaseClientLike,
  artifacts: AssignmentSubmissionArtifact[]
): Promise<AssignmentSubmissionArtifact[]> {
  return Promise.all(
    artifacts.map(async (artifact) => {
      if (artifact.type !== 'image' || !artifact.storage_path) return artifact

      const { data, error } = await supabase.storage
        .from(ASSIGNMENT_ARTIFACTS_BUCKET)
        .createSignedUrl(artifact.storage_path, SIGNED_IMAGE_URL_EXPIRES_SECONDS)

      if (error || !data?.signedUrl) return artifact
      return {
        ...artifact,
        url: data.signedUrl,
      }
    })
  )
}

export async function loadAssignmentSubmissionRequirements(
  supabase: SupabaseClientLike,
  assignmentId: string
): Promise<AssignmentSubmissionRequirement[]> {
  try {
    const query = supabase.from('assignment_submission_requirements')
    if (!query) return []
    const { data, error } = await query
      .select('*')
      .eq('assignment_id', assignmentId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) {
      if (isMissingAssignmentSubmissionSchemaError(error)) return []
      throw new Error('Failed to load assignment submission requirements')
    }

    return (data || []) as AssignmentSubmissionRequirement[]
  } catch (error) {
    if (isMissingAssignmentSubmissionSchemaError(error)) return []
    throw error
  }
}

export async function loadAssignmentSubmissionArtifactsForDoc(
  supabase: SupabaseClientLike,
  assignmentDocId: string
): Promise<AssignmentSubmissionArtifact[]> {
  try {
    const query = supabase.from('assignment_submission_artifacts')
    if (!query) return []
    const { data, error } = await query
      .select('*')
      .eq('assignment_doc_id', assignmentDocId)

    if (error) {
      if (isMissingAssignmentSubmissionSchemaError(error)) return []
      throw new Error('Failed to load assignment submission artifacts')
    }

    return signArtifactImageUrls(supabase, (data || []) as AssignmentSubmissionArtifact[])
  } catch (error) {
    if (isMissingAssignmentSubmissionSchemaError(error)) return []
    throw error
  }
}

export async function loadAssignmentSubmissionArtifactsForDocs(
  supabase: SupabaseClientLike,
  assignmentDocIds: string[]
): Promise<AssignmentSubmissionArtifact[]> {
  if (assignmentDocIds.length === 0) return []

  try {
    const query = supabase.from('assignment_submission_artifacts')
    if (!query) return []
    const { data, error } = await query
      .select('*')
      .in('assignment_doc_id', assignmentDocIds)

    if (error) {
      if (isMissingAssignmentSubmissionSchemaError(error)) return []
      throw new Error('Failed to load assignment submission artifacts')
    }

    return signArtifactImageUrls(supabase, (data || []) as AssignmentSubmissionArtifact[])
  } catch (error) {
    if (isMissingAssignmentSubmissionSchemaError(error)) return []
    throw error
  }
}

function uniqueStoragePaths(paths: Array<string | null | undefined>): string[] {
  const unique = new Set<string>()
  for (const path of paths) {
    const trimmed = path?.trim()
    if (trimmed) unique.add(trimmed)
  }
  return Array.from(unique)
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize))
  }
  return chunks
}

export function getRemovedImageSubmissionRequirementIds(
  existingRequirements: AssignmentSubmissionRequirement[],
  drafts: AssignmentSubmissionRequirementDraft[]
): string[] {
  const normalizedDrafts = normalizeAssignmentSubmissionRequirementDrafts(drafts)
  const existingById = new Map(existingRequirements.map((requirement) => [requirement.id, requirement]))
  const preservedIds = new Set<string>()

  for (const draft of normalizedDrafts) {
    if (!draft.id) continue
    const existing = existingById.get(draft.id)
    if (existing && existing.type === draft.type) {
      preservedIds.add(existing.id)
    }
  }

  return existingRequirements
    .filter((requirement) => requirement.type === 'image' && !preservedIds.has(requirement.id))
    .map((requirement) => requirement.id)
}

export async function loadImageArtifactStoragePathsForRequirements(
  supabase: SupabaseClientLike,
  requirementIds: string[]
): Promise<string[]> {
  if (requirementIds.length === 0) return []

  try {
    const query = supabase.from('assignment_submission_artifacts')
    if (!query) return []
    const { data, error } = await query
      .select('storage_path')
      .eq('type', 'image')
      .not('storage_path', 'is', null)
      .in('requirement_id', requirementIds)

    if (error) {
      if (isMissingAssignmentSubmissionSchemaError(error)) return []
      throw new Error('Failed to load assignment artifact storage paths')
    }

    return uniqueStoragePaths((data || []).map((row: { storage_path?: string | null }) => row.storage_path))
  } catch (error) {
    if (isMissingAssignmentSubmissionSchemaError(error)) return []
    throw error
  }
}

export async function collectRemovedImageArtifactStoragePaths(
  supabase: SupabaseClientLike,
  assignmentId: string,
  drafts: AssignmentSubmissionRequirementDraft[]
): Promise<string[]> {
  try {
    const existingRequirements = await loadAssignmentSubmissionRequirements(supabase, assignmentId)
    const removedImageRequirementIds = getRemovedImageSubmissionRequirementIds(existingRequirements, drafts)
    return loadImageArtifactStoragePathsForRequirements(supabase, removedImageRequirementIds)
  } catch (error) {
    console.error('Failed to collect removed assignment image artifact storage paths:', error)
    return []
  }
}

export async function collectAssignmentImageArtifactStoragePaths(
  supabase: SupabaseClientLike,
  assignmentId: string
): Promise<string[]> {
  try {
    const existingRequirements = await loadAssignmentSubmissionRequirements(supabase, assignmentId)
    const imageRequirementIds = existingRequirements
      .filter((requirement) => requirement.type === 'image')
      .map((requirement) => requirement.id)

    return loadImageArtifactStoragePathsForRequirements(supabase, imageRequirementIds)
  } catch (error) {
    console.error('Failed to collect assignment image artifact storage paths:', error)
    return []
  }
}

export async function removeAssignmentArtifactStorageObjects(
  supabase: SupabaseClientLike,
  storagePaths: string[],
  context: string
): Promise<void> {
  const paths = uniqueStoragePaths(storagePaths)
  if (paths.length === 0) return

  for (const chunk of chunkArray(paths, STORAGE_REMOVE_CHUNK_SIZE)) {
    try {
      const { error } = await supabase.storage
        .from(ASSIGNMENT_ARTIFACTS_BUCKET)
        .remove(chunk)

      if (error) {
        console.error('Failed to remove assignment artifact storage objects:', {
          context,
          bucket: ASSIGNMENT_ARTIFACTS_BUCKET,
          paths: chunk,
          error,
        })
      }
    } catch (error) {
      console.error('Failed to remove assignment artifact storage objects:', {
        context,
        bucket: ASSIGNMENT_ARTIFACTS_BUCKET,
        paths: chunk,
        error,
      })
    }
  }
}

export async function replaceAssignmentSubmissionRequirements(
  supabase: SupabaseClientLike,
  assignmentId: string,
  drafts: AssignmentSubmissionRequirementDraft[]
): Promise<AssignmentSubmissionRequirement[]> {
  const normalized = normalizeAssignmentSubmissionRequirementDrafts(drafts)

  try {
    if (!supabase.rpc) return []
    const { data, error } = await supabase.rpc('replace_assignment_submission_requirements_atomic', {
      p_assignment_id: assignmentId,
      p_requirements: normalized,
    })

    if (error) {
      if (isMissingAssignmentSubmissionSchemaError(error)) return []
      throw new Error('Failed to save assignment submission requirements')
    }

    return (data || []) as AssignmentSubmissionRequirement[]
  } catch (error) {
    if (isMissingAssignmentSubmissionSchemaError(error)) return []
    throw error
  }
}

export async function loadUserGitHubIdentity(
  supabase: SupabaseClientLike,
  userId: string
) {
  try {
    const query = supabase.from('user_github_identities')
    if (!query) return null
    const { data, error } = await query
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    if (error) {
      if (isMissingAssignmentSubmissionSchemaError(error)) return null
      throw new Error('Failed to load GitHub identity')
    }

    return data || null
  } catch (error) {
    if (isMissingAssignmentSubmissionSchemaError(error)) return null
    throw error
  }
}
