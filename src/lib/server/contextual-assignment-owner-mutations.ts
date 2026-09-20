import { z } from 'zod'

import { ApiError } from '@/lib/api-error'
import { isRetryableDatabaseContention } from '@/lib/server/database-contention'
import type { AssignmentSubmissionRequirement } from '@/types'
import type { TableRow } from '@/types/database'
import type { Json } from '@/types/database.generated'

const canonicalUuid = z.string().uuid().transform((value) => value.toLowerCase())
const assignmentSchema = z.object({
  id: canonicalUuid,
  classroom_id: canonicalUuid,
}).passthrough()
const requirementSchema = z.object({
  id: canonicalUuid,
  assignment_id: canonicalUuid,
}).passthrough()
const atomicErrorSchema = z.object({
  ok: z.literal(false),
  status: z.number().int().min(400).max(599),
  error_code: z.string().min(1),
  error: z.string().min(1),
}).strip()
const updateSuccessSchema = z.object({
  ok: z.literal(true),
  assignment: assignmentSchema,
  submission_requirements: z.array(requirementSchema),
}).strip()
const releaseSuccessSchema = z.object({
  ok: z.literal(true),
  assignment: assignmentSchema,
}).strip()
const deleteSuccessSchema = z.object({
  ok: z.literal(true),
  classroom_id: canonicalUuid,
  deleted: z.literal(true),
}).strip()
const discardResultSchema = z.discriminatedUnion('discarded', [
  z.object({ discarded: z.literal(true) }).passthrough(),
  z.object({
    discarded: z.literal(false),
    assignment: assignmentSchema,
  }).passthrough(),
])

type RpcError = { code?: string; message?: string; details?: string }

export type ContextualAssignmentOwnerMutationClient = {
  rpc: (
    name:
      | 'update_assignment_for_owner_v1'
      | 'release_assignment_for_owner_v1'
      | 'delete_assignment_for_owner_v1'
      | 'discard_pristine_assignment_draft_for_owner_v1',
    args:
      | { p_actor_id: string; p_assignment_id: string; p_updates: Json; p_requirements?: Json }
      | { p_actor_id: string; p_assignment_id: string; p_released_at: string; p_scheduled: boolean }
      | { p_actor_id: string; p_assignment_id: string }
      | { p_actor_id: string; p_assignment_id: string; p_expected_updated_at: string },
  ) => PromiseLike<{ data: unknown; error: RpcError | null }>
}

type AtomicError = {
  ok: false
  status: number
  error: string
  errorCode: string
}

function parseIds(actorId: string, assignmentId: string) {
  const actor = canonicalUuid.safeParse(actorId)
  const assignment = canonicalUuid.safeParse(assignmentId)
  if (!actor.success || !assignment.success) {
    throw new ApiError(400, 'Invalid assignment owner mutation request')
  }
  return { actorId: actor.data, assignmentId: assignment.data }
}

function mapRpcError(error: RpcError): never {
  if (error.code === 'P0002') throw new ApiError(404, 'Assignment not found')
  if (error.code === '42501') throw new ApiError(403, 'Unauthorized')
  if (error.code === '55000') throw new ApiError(403, 'Classroom is archived')
  if (isRetryableDatabaseContention(error)) {
    throw new ApiError(409, 'Assignment changed during this update. Refresh and try again.')
  }
  if (error.code === '22023' || error.code === '22P02') {
    throw new ApiError(400, 'Invalid assignment owner mutation request')
  }
  throw new ApiError(503, 'Unable to update assignment')
}

function parseAtomicError(data: unknown): AtomicError | null {
  const parsed = atomicErrorSchema.safeParse(data)
  if (!parsed.success) return null
  return {
    ok: false,
    status: parsed.data.status,
    error: parsed.data.error,
    errorCode: parsed.data.error_code,
  }
}

export async function updateAssignmentForOwner(input: {
  supabase: ContextualAssignmentOwnerMutationClient
  actorId: string
  assignmentId: string
  updates: Record<string, unknown>
  requirements?: unknown[]
}): Promise<{
  ok: true
  assignment: TableRow<'assignments'>
  submissionRequirements: AssignmentSubmissionRequirement[]
} | AtomicError> {
  const ids = parseIds(input.actorId, input.assignmentId)
  const { data, error } = await input.supabase.rpc('update_assignment_for_owner_v1', {
    p_actor_id: ids.actorId,
    p_assignment_id: ids.assignmentId,
    p_updates: input.updates as Json,
    p_requirements: input.requirements === undefined ? null : input.requirements as Json,
  })
  if (error) mapRpcError(error)

  const atomicError = parseAtomicError(data)
  if (atomicError) return atomicError
  const parsed = updateSuccessSchema.safeParse(data)
  if (
    !parsed.success
    || parsed.data.assignment.id !== ids.assignmentId
    || parsed.data.submission_requirements.some((row) => row.assignment_id !== ids.assignmentId)
  ) {
    throw new ApiError(503, 'Unable to verify assignment update')
  }
  return {
    ok: true,
    assignment: parsed.data.assignment as TableRow<'assignments'>,
    submissionRequirements: parsed.data.submission_requirements as unknown as AssignmentSubmissionRequirement[],
  }
}

export async function releaseAssignmentForOwner(input: {
  supabase: ContextualAssignmentOwnerMutationClient
  actorId: string
  assignmentId: string
  releasedAt: string
  scheduled: boolean
}): Promise<{ ok: true; assignment: TableRow<'assignments'> } | AtomicError> {
  const ids = parseIds(input.actorId, input.assignmentId)
  const { data, error } = await input.supabase.rpc('release_assignment_for_owner_v1', {
    p_actor_id: ids.actorId,
    p_assignment_id: ids.assignmentId,
    p_released_at: input.releasedAt,
    p_scheduled: input.scheduled,
  })
  if (error) mapRpcError(error)

  const atomicError = parseAtomicError(data)
  if (atomicError) return atomicError
  const parsed = releaseSuccessSchema.safeParse(data)
  if (!parsed.success || parsed.data.assignment.id !== ids.assignmentId) {
    throw new ApiError(503, 'Unable to verify assignment release')
  }
  return { ok: true, assignment: parsed.data.assignment as TableRow<'assignments'> }
}

export async function deleteAssignmentForOwner(input: {
  supabase: ContextualAssignmentOwnerMutationClient
  actorId: string
  assignmentId: string
}): Promise<{ ok: true; classroomId: string }> {
  const ids = parseIds(input.actorId, input.assignmentId)
  const { data, error } = await input.supabase.rpc('delete_assignment_for_owner_v1', {
    p_actor_id: ids.actorId,
    p_assignment_id: ids.assignmentId,
  })
  if (error) mapRpcError(error)

  const parsed = deleteSuccessSchema.safeParse(data)
  if (!parsed.success) throw new ApiError(503, 'Unable to verify assignment deletion')
  return { ok: true, classroomId: parsed.data.classroom_id }
}

export async function discardPristineAssignmentDraftForOwner(input: {
  supabase: ContextualAssignmentOwnerMutationClient
  actorId: string
  assignmentId: string
  expectedUpdatedAt: string
}): Promise<
  | { discarded: true }
  | { discarded: false; assignment: TableRow<'assignments'> }
> {
  const ids = parseIds(input.actorId, input.assignmentId)
  const { data, error } = await input.supabase.rpc(
    'discard_pristine_assignment_draft_for_owner_v1',
    {
      p_actor_id: ids.actorId,
      p_assignment_id: ids.assignmentId,
      p_expected_updated_at: input.expectedUpdatedAt,
    },
  )
  if (error) mapRpcError(error)

  const parsed = discardResultSchema.safeParse(data)
  if (!parsed.success) throw new ApiError(503, 'Unable to verify assignment discard')
  if (parsed.data.discarded) return { discarded: true }
  if (parsed.data.assignment.id !== ids.assignmentId) {
    throw new ApiError(503, 'Unable to verify assignment discard')
  }
  return {
    discarded: false,
    assignment: parsed.data.assignment as TableRow<'assignments'>,
  }
}
