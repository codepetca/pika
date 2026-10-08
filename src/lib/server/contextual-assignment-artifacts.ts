import { z } from 'zod'

import { ApiError } from '@/lib/api-error'
import { isRetryableDatabaseContention } from '@/lib/server/database-contention'
import type {
  AssignmentSubmissionArtifact,
  AssignmentSubmissionRequirement,
} from '@/types'
import type { Json } from '@/types/database.generated'

const canonicalUuid = z.string().uuid().transform((value) => value.toLowerCase())
const timestamp = z.string().datetime({ offset: true })
const nullableTimestamp = timestamp.nullable()
const requirementSchema = z.object({
  id: canonicalUuid,
  artifact_id: canonicalUuid,
  source_artifact_id: canonicalUuid.nullable().optional(),
  source_blueprint_version_id: canonicalUuid.nullable().optional(),
  assignment_id: canonicalUuid,
  type: z.enum(['repo_link', 'link', 'image']),
  label: z.string(),
  instructions: z.string(),
  required: z.boolean(),
  position: z.number().int(),
  validation_policy_json: z.record(z.string(), z.unknown()),
  created_at: timestamp,
  updated_at: timestamp,
}).strip()
const artifactSchema = z.object({
  id: canonicalUuid,
  assignment_doc_id: canonicalUuid,
  requirement_id: canonicalUuid,
  student_id: canonicalUuid,
  type: z.enum(['repo_link', 'link', 'image']),
  url: z.string().nullable(),
  storage_path: z.string().nullable(),
  metadata_json: z.record(z.string(), z.unknown()),
  validation_status: z.enum(['missing', 'pending', 'valid', 'warning', 'invalid', 'inaccessible']),
  validation_message: z.string().nullable(),
  validated_at: nullableTimestamp,
  created_at: timestamp,
  updated_at: timestamp,
}).strip()
const atomicErrorSchema = z.object({
  ok: z.literal(false),
  status: z.union([z.literal(400), z.literal(403), z.literal(404), z.literal(409), z.literal(500)]),
  error_code: z.string(),
  error: z.string(),
}).strict()
const prepareSuccessSchema = z.object({
  ok: z.literal(true),
  classroom_id: canonicalUuid,
  assignment_doc_id: canonicalUuid,
  requirement: requirementSchema,
  artifact: artifactSchema.nullable(),
}).strict()
const upsertSuccessSchema = z.object({
  ok: z.literal(true),
  classroom_id: canonicalUuid,
  artifact: artifactSchema,
  previous_storage_path: z.string().nullable(),
}).strict()
const deleteSuccessSchema = z.object({
  ok: z.literal(true),
  classroom_id: canonicalUuid,
  deleted: z.boolean(),
  storage_path: z.string().nullable(),
}).strict()

type RpcError = { code?: string; message?: string; details?: string }

export type ContextualAssignmentArtifactClient = {
  rpc: (
    name:
      | 'prepare_assignment_artifact_for_member_v1'
      | 'upsert_assignment_artifact_for_member_v1'
      | 'delete_assignment_artifact_for_member_v1',
    args: Record<string, Json | string | number | boolean | null>,
  ) => PromiseLike<{ data: unknown; error: RpcError | null }>
}

export type ContextualAssignmentArtifactContext = {
  ok: true
  classroomId: string
  assignmentDocId: string
  requirement: AssignmentSubmissionRequirement
  artifact: AssignmentSubmissionArtifact | null
}

export type ContextualAssignmentArtifactMutationResult =
  | {
      ok: true
      classroomId: string
      artifact: AssignmentSubmissionArtifact
      previousStoragePath: string | null
    }
  | { ok: false; status: number; error: string; errorCode: string }

export type ContextualAssignmentArtifactDeleteResult =
  | {
      ok: true
      classroomId: string
      deleted: boolean
      storagePath: string | null
    }
  | { ok: false; status: number; error: string; errorCode: string }

function parseIds(input: {
  actorId: string
  assignmentId: string
  requirementId: string
}) {
  const actorId = canonicalUuid.safeParse(input.actorId)
  const assignmentId = canonicalUuid.safeParse(input.assignmentId)
  const requirementId = canonicalUuid.safeParse(input.requirementId)
  if (!actorId.success || !assignmentId.success || !requirementId.success) {
    throw new ApiError(400, 'Invalid assignment artifact request')
  }
  return {
    actorId: actorId.data,
    assignmentId: assignmentId.data,
    requirementId: requirementId.data,
  }
}

function mapRpcError(error: RpcError): never {
  if (error.code === 'P0002') {
    throw new ApiError(404, error.message === 'Requirement not found'
      ? 'Requirement not found'
      : 'Assignment not found')
  }
  if (error.code === '42501') throw new ApiError(403, 'Forbidden')
  if (error.code === '22023' && error.message === 'Invalid assignment artifact request') {
    throw new ApiError(400, 'Invalid assignment artifact request')
  }
  if (
    isRetryableDatabaseContention(error)
    || error.code === '55000'
    || (
      error.code === '23514'
      && error.message?.includes('assignment_artifact_submitted_document_immutable')
    )
  ) {
    throw new ApiError(409, 'Assignment access changed. Refresh and try again.')
  }
  throw new ApiError(503, 'Unable to update assignment attachment')
}

function parseAtomicError(data: unknown) {
  const parsed = atomicErrorSchema.safeParse(data)
  if (!parsed.success) return null
  return {
    ok: false as const,
    status: parsed.data.status,
    error: parsed.data.error,
    errorCode: parsed.data.error_code,
  }
}

export async function prepareContextualAssignmentArtifact(input: {
  supabase: ContextualAssignmentArtifactClient
  actorId: string
  assignmentId: string
  requirementId: string
}): Promise<ContextualAssignmentArtifactContext | {
  ok: false
  status: number
  error: string
  errorCode: string
}> {
  const ids = parseIds(input)
  const { data, error } = await input.supabase.rpc(
    'prepare_assignment_artifact_for_member_v1',
    {
      p_actor_id: ids.actorId,
      p_assignment_id: ids.assignmentId,
      p_requirement_id: ids.requirementId,
    },
  )
  if (error) mapRpcError(error)

  const atomicError = parseAtomicError(data)
  if (atomicError) return atomicError

  const parsed = prepareSuccessSchema.safeParse(data)
  if (
    !parsed.success
    || parsed.data.requirement.assignment_id !== ids.assignmentId
    || parsed.data.requirement.id !== ids.requirementId
    || (
      parsed.data.artifact !== null
      && (
        parsed.data.artifact.assignment_doc_id !== parsed.data.assignment_doc_id
        || parsed.data.artifact.requirement_id !== ids.requirementId
        || parsed.data.artifact.student_id !== ids.actorId
        || parsed.data.artifact.type !== parsed.data.requirement.type
      )
    )
  ) {
    throw new ApiError(503, 'Unable to verify assignment attachment')
  }

  return {
    ok: true,
    classroomId: parsed.data.classroom_id,
    assignmentDocId: parsed.data.assignment_doc_id,
    requirement: parsed.data.requirement as AssignmentSubmissionRequirement,
    artifact: parsed.data.artifact as AssignmentSubmissionArtifact | null,
  }
}

export async function upsertContextualAssignmentArtifact(input: {
  supabase: ContextualAssignmentArtifactClient
  actorId: string
  assignmentId: string
  requirementId: string
  type: 'repo_link' | 'link' | 'image'
  url: string | null
  storagePath: string | null
  metadata: Record<string, unknown>
  validationStatus: 'missing' | 'pending' | 'valid' | 'warning' | 'invalid' | 'inaccessible'
  validationMessage: string | null
  validatedAt: string
  managedObjectId: string | null
  githubIdentity?: {
    login: string
    validationStatus: 'unvalidated' | 'valid' | 'invalid' | 'inaccessible'
    validationMessage: string | null
  }
}): Promise<ContextualAssignmentArtifactMutationResult> {
  const ids = parseIds(input)
  const managedObjectId = input.managedObjectId === null
    ? null
    : canonicalUuid.safeParse(input.managedObjectId)
  if (managedObjectId !== null && !managedObjectId.success) {
    throw new ApiError(400, 'Invalid assignment artifact request')
  }

  const { data, error } = await input.supabase.rpc(
    'upsert_assignment_artifact_for_member_v1',
    {
      p_actor_id: ids.actorId,
      p_assignment_id: ids.assignmentId,
      p_requirement_id: ids.requirementId,
      p_type: input.type,
      p_url: input.url,
      p_storage_path: input.storagePath,
      p_metadata_json: input.metadata as Json,
      p_validation_status: input.validationStatus,
      p_validation_message: input.validationMessage,
      p_validated_at: input.validatedAt,
      p_managed_object_id: managedObjectId === null ? null : managedObjectId.data,
      p_save_github_identity: input.githubIdentity !== undefined,
      p_github_login: input.githubIdentity?.login ?? null,
      p_github_validation_status: input.githubIdentity?.validationStatus ?? null,
      p_github_validation_message: input.githubIdentity?.validationMessage ?? null,
    },
  )
  if (error) mapRpcError(error)

  const atomicError = parseAtomicError(data)
  if (atomicError) return atomicError

  const parsed = upsertSuccessSchema.safeParse(data)
  if (
    !parsed.success
    || parsed.data.artifact.requirement_id !== ids.requirementId
    || parsed.data.artifact.student_id !== ids.actorId
    || parsed.data.artifact.type !== input.type
  ) {
    throw new ApiError(503, 'Unable to verify assignment attachment')
  }

  return {
    ok: true,
    classroomId: parsed.data.classroom_id,
    artifact: parsed.data.artifact as AssignmentSubmissionArtifact,
    previousStoragePath: parsed.data.previous_storage_path,
  }
}

export async function deleteContextualAssignmentArtifact(input: {
  supabase: ContextualAssignmentArtifactClient
  actorId: string
  assignmentId: string
  requirementId: string
}): Promise<ContextualAssignmentArtifactDeleteResult> {
  const ids = parseIds(input)
  const { data, error } = await input.supabase.rpc(
    'delete_assignment_artifact_for_member_v1',
    {
      p_actor_id: ids.actorId,
      p_assignment_id: ids.assignmentId,
      p_requirement_id: ids.requirementId,
    },
  )
  if (error) mapRpcError(error)

  const atomicError = parseAtomicError(data)
  if (atomicError) return atomicError

  const parsed = deleteSuccessSchema.safeParse(data)
  if (!parsed.success) {
    throw new ApiError(503, 'Unable to verify assignment attachment deletion')
  }
  return {
    ok: true,
    classroomId: parsed.data.classroom_id,
    deleted: parsed.data.deleted,
    storagePath: parsed.data.storage_path,
  }
}
