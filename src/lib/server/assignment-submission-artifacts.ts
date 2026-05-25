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
