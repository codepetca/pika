import {
  normalizeAssignmentSubmissionRequirementDrafts,
  type AssignmentSubmissionRequirementDraft,
} from '@/lib/assignment-submission-requirements'
import type {
  AssignmentSubmissionArtifact,
  AssignmentSubmissionRequirement,
} from '@/types'
import { loadChunkedRows } from '@/lib/server/query-chunks'
import type { TableRow } from '@/types/database'
import { z } from 'zod'
import { assignmentSubmissionContentSchema } from '@/lib/validations/assignment-doc-submissions'

const ASSIGNMENT_ARTIFACTS_BUCKET = 'assignment-artifacts'
const SIGNED_IMAGE_URL_EXPIRES_SECONDS = 60 * 60
const STORAGE_REMOVE_CHUNK_SIZE = 1000
const timestampSchema = z.string().datetime({ offset: true })

const assignmentRowSchema = z.object({
  classroom_id: z.string().min(1),
  created_at: timestampSchema,
  created_by: z.string().min(1),
  description: z.string(),
  due_at: timestampSchema,
  gradebook_weight: z.number(),
  id: z.string().min(1),
  include_in_final: z.boolean(),
  instructions_markdown: z.string().nullable(),
  is_draft: z.boolean(),
  points_possible: z.number(),
  position: z.number().int(),
  released_at: timestampSchema.nullable(),
  rich_instructions: assignmentSubmissionContentSchema.nullable(),
  title: z.string(),
  track_authenticity: z.boolean(),
  updated_at: timestampSchema,
}).strip()

const assignmentRequirementRowSchema = z.object({
  assignment_id: z.string().min(1),
  created_at: timestampSchema,
  id: z.string().min(1),
  instructions: z.string(),
  label: z.string(),
  position: z.number().int(),
  required: z.boolean(),
  type: z.enum(['repo_link', 'link', 'image']),
  updated_at: timestampSchema,
  validation_policy_json: z.record(z.string(), z.unknown()),
}).strip()

const assignmentRequirementsAtomicErrorSchema = z.object({
  ok: z.literal(false),
  status: z.number().int().min(400).max(599),
  error_code: z.string().min(1),
  error: z.string().min(1),
}).strip()

const assignmentRequirementsAtomicSuccessSchema = z.object({
  ok: z.literal(true),
  assignment: assignmentRowSchema,
  submission_requirements: z.array(assignmentRequirementRowSchema),
}).strip()

const assignmentArtifactDeleteResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    deleted: z.boolean(),
    storage_path: z.string().nullable(),
  }).strip(),
  assignmentRequirementsAtomicErrorSchema,
])

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
    if (typeof supabase.from !== 'function') return []
    const { rows, error } = await loadChunkedRows<AssignmentSubmissionArtifact>({
      supabase,
      table: 'assignment_submission_artifacts',
      select: '*',
      filters: [{ column: 'assignment_doc_id', values: assignmentDocIds }],
      pageSize: 1000,
    })

    if (error) {
      if (isMissingAssignmentSubmissionSchemaError(error)) return []
      throw new Error('Failed to load assignment submission artifacts')
    }

    return signArtifactImageUrls(supabase, rows)
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

export async function updateAssignmentWithSubmissionRequirementsAtomic(input: {
  supabase: SupabaseClientLike
  assignmentId: string
  updates: Record<string, unknown>
  requirements: AssignmentSubmissionRequirementDraft[]
}): Promise<
  | {
      ok: true
      assignment: TableRow<'assignments'>
      submissionRequirements: AssignmentSubmissionRequirement[]
    }
  | { ok: false; status: number; error: string }
> {
  const normalized = normalizeAssignmentSubmissionRequirementDrafts(input.requirements)
  const { data, error } = await input.supabase.rpc(
    'update_assignment_with_submission_requirements_atomic',
    {
      p_assignment_id: input.assignmentId,
      p_updates: input.updates,
      p_requirements: normalized,
    }
  )

  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') {
      return { ok: false, status: 500, error: 'Assignment submission migration is required' }
    }
    if (
      error.code === '23514'
      && String(error.message).includes('assignment_requirements_submitted_documents_immutable')
    ) {
      return {
        ok: false,
        status: 409,
        error: 'Submission requirements cannot be changed after a student submits.',
      }
    }
    console.error('Error updating assignment and submission requirements atomically:', error)
    return { ok: false, status: 500, error: 'Failed to update assignment' }
  }

  const parsedError = assignmentRequirementsAtomicErrorSchema.safeParse(data)
  if (parsedError.success) {
    return {
      ok: false,
      status: parsedError.data.status,
      error: parsedError.data.error,
    }
  }

  const parsed = assignmentRequirementsAtomicSuccessSchema.safeParse(data)
  if (!parsed.success) {
    console.error('Invalid assignment requirements atomic RPC result:', parsed.error)
    return { ok: false, status: 500, error: 'Failed to update assignment' }
  }

  return {
    ok: true,
    assignment: parsed.data.assignment,
    submissionRequirements: parsed.data.submission_requirements,
  }
}

export async function deleteAssignmentSubmissionArtifactAtomic(input: {
  supabase: SupabaseClientLike
  assignmentId: string
  studentId: string
  requirementId: string
}): Promise<
  | { ok: true; deleted: boolean; storagePath: string | null }
  | { ok: false; status: number; error: string }
> {
  const { data, error } = await input.supabase.rpc(
    'delete_assignment_submission_artifact_atomic',
    {
      p_assignment_id: input.assignmentId,
      p_student_id: input.studentId,
      p_requirement_id: input.requirementId,
    }
  )
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') {
      return { ok: false, status: 503, error: 'Assignment submission migration is required' }
    }
    console.error('Failed to delete assignment submission artifact atomically:', error)
    return { ok: false, status: 500, error: 'Failed to delete submission artifact' }
  }

  const parsed = assignmentArtifactDeleteResultSchema.safeParse(data)
  if (!parsed.success) {
    console.error('Invalid assignment artifact deletion RPC result:', parsed.error)
    return { ok: false, status: 500, error: 'Failed to delete submission artifact' }
  }
  if (!parsed.data.ok) {
    return { ok: false, status: parsed.data.status, error: parsed.data.error }
  }
  return {
    ok: true,
    deleted: parsed.data.deleted,
    storagePath: parsed.data.storage_path,
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
