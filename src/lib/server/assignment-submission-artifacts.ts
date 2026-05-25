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
    combined.includes('user_github_identities')
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
    const requirementsQuery = supabase.from('assignment_submission_requirements')
    if (!requirementsQuery) return []
    const { data: existingRequirements, error: existingError } = await requirementsQuery
      .select('*')
      .eq('assignment_id', assignmentId)

    if (existingError) {
      if (isMissingAssignmentSubmissionSchemaError(existingError)) return []
      throw new Error('Failed to load assignment submission requirements')
    }

    const existingById = new Map(
      ((existingRequirements || []) as AssignmentSubmissionRequirement[])
        .map((requirement) => [requirement.id, requirement])
    )
    const preservedIds = new Set(
      normalized
        .filter((requirement) => {
          const existing = requirement.id ? existingById.get(requirement.id) : null
          return Boolean(existing && existing.type === requirement.type)
        })
        .map((requirement) => requirement.id as string)
    )
    const removedIds = ((existingRequirements || []) as AssignmentSubmissionRequirement[])
      .filter((requirement) => !preservedIds.has(requirement.id))
      .map((requirement) => requirement.id)

    if (removedIds.length > 0) {
      const deleteQuery = supabase.from('assignment_submission_requirements')
      if (!deleteQuery) return []
      const { error: deleteError } = await deleteQuery
        .delete()
        .eq('assignment_id', assignmentId)
        .in('id', removedIds)

      if (deleteError) {
        if (isMissingAssignmentSubmissionSchemaError(deleteError)) return []
        throw new Error('Failed to clear assignment submission requirements')
      }
    }

    if (normalized.length === 0) return []

    const preservedRows = normalized
      .filter((requirement) => requirement.id && preservedIds.has(requirement.id))
      .map((requirement) => ({
        id: requirement.id,
        assignment_id: assignmentId,
        type: requirement.type,
        label: requirement.label,
        instructions: requirement.instructions,
        required: requirement.required,
        position: requirement.position,
        validation_policy_json: requirement.validation_policy_json,
      }))
    const newRows = normalized
      .filter((requirement) => !requirement.id || !preservedIds.has(requirement.id))
      .map((requirement) => ({
        assignment_id: assignmentId,
        type: requirement.type,
        label: requirement.label,
        instructions: requirement.instructions,
        required: requirement.required,
        position: requirement.position,
        validation_policy_json: requirement.validation_policy_json,
      }))

    if (preservedRows.length > 0) {
      const upsertQuery = supabase.from('assignment_submission_requirements')
      if (!upsertQuery) return []
      const { error } = await upsertQuery
        .upsert(preservedRows, { onConflict: 'id' })

      if (error) {
        if (isMissingAssignmentSubmissionSchemaError(error)) return []
        throw new Error('Failed to save assignment submission requirements')
      }
    }

    if (newRows.length > 0) {
      const insertQuery = supabase.from('assignment_submission_requirements')
      if (!insertQuery) return []
      const { error } = await insertQuery
        .insert(newRows)

      if (error) {
        if (isMissingAssignmentSubmissionSchemaError(error)) return []
        throw new Error('Failed to save assignment submission requirements')
      }
    }

    return loadAssignmentSubmissionRequirements(supabase, assignmentId)
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
