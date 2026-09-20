import { z } from 'zod'

import { ApiError } from '@/lib/api-error'
import { isRetryableDatabaseContention } from '@/lib/server/database-contention'
import type { TableRow } from '@/types/database'
import type { Json } from '@/types/database.generated'

const canonicalUuid = z.string().uuid().transform((value) => value.toLowerCase())
const inputAssignmentSchema = z.object({
  id: canonicalUuid.optional(),
  title: z.string().min(1),
  dueAt: z.string().min(1),
  instructionsMarkdown: z.string(),
  description: z.string(),
  richInstructions: z.custom<Json>((value) => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
  )),
  isDraft: z.boolean(),
}).strict()
const inputSchema = z.array(inputAssignmentSchema).max(50)
const assignmentEvidenceSchema = z.object({
  id: canonicalUuid,
  classroom_id: canonicalUuid,
  created_by: canonicalUuid,
}).passthrough()
const successSchema = z.object({
  ok: z.literal(true),
  actor_id: canonicalUuid,
  classroom_id: canonicalUuid,
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  assignments: z.array(assignmentEvidenceSchema),
}).strict()
const validationFailureSchema = z.object({
  ok: z.literal(false),
  status: z.literal(400),
  errors: z.array(z.string()).min(1).max(50),
}).strict()

type RpcError = { code?: string; message?: string }

type AssignmentBulkClient = {
  rpc: (
    name: 'save_assignments_bulk_for_owner_v1',
    args: {
      p_actor_id: string
      p_classroom_id: string
      p_assignments: Json
    },
  ) => PromiseLike<{ data: unknown; error: RpcError | null }>
}

export type ContextualAssignmentBulkInput = z.infer<typeof inputAssignmentSchema>
export type ContextualAssignmentBulkResult =
  | {
      ok: true
      created: number
      updated: number
      assignments: TableRow<'assignments'>[]
    }
  | { ok: false; errors: string[] }

function mapBulkError(error: RpcError): never {
  if (error.code === 'P0002') throw new ApiError(404, 'Classroom not found')
  if (error.code === '42501') throw new ApiError(403, 'Unauthorized')
  if (error.code === '55000' && error.message === 'assignment_bulk_archived') {
    throw new ApiError(403, 'Classroom is archived')
  }
  if (error.code === '40001' || isRetryableDatabaseContention(error)) {
    throw new ApiError(409, 'Classroom changed during this update. Refresh and try again.')
  }
  if (error.code === '22023'
    || error.code === '22007'
    || error.code === '22P02'
    || error.code === '23502'
  ) {
    throw new ApiError(400, 'Invalid assignment bulk request')
  }
  throw new ApiError(503, 'Unable to save assignments')
}

export async function saveAssignmentsBulkForOwner(input: {
  supabase: AssignmentBulkClient
  actorId: string
  classroomId: string
  assignments: ContextualAssignmentBulkInput[]
}): Promise<ContextualAssignmentBulkResult> {
  const actor = canonicalUuid.safeParse(input.actorId)
  const classroom = canonicalUuid.safeParse(input.classroomId)
  const assignments = inputSchema.safeParse(input.assignments)
  if (!actor.success || !classroom.success || !assignments.success) {
    throw new ApiError(400, 'Invalid assignment bulk request')
  }

  const payload = assignments.data.map((assignment) => ({
    ...(assignment.id ? { id: assignment.id } : {}),
    title: assignment.title,
    due_at: assignment.dueAt,
    instructions_markdown: assignment.instructionsMarkdown,
    description: assignment.description,
    rich_instructions: assignment.richInstructions,
    is_draft: assignment.isDraft,
  }))
  const { data, error } = await input.supabase.rpc('save_assignments_bulk_for_owner_v1', {
    p_actor_id: actor.data,
    p_classroom_id: classroom.data,
    p_assignments: payload as Json,
  })
  if (error) mapBulkError(error)

  const validationFailure = validationFailureSchema.safeParse(data)
  if (validationFailure.success) {
    return { ok: false, errors: validationFailure.data.errors }
  }

  const parsed = successSchema.safeParse(data)
  if (!parsed.success
    || parsed.data.actor_id !== actor.data
    || parsed.data.classroom_id !== classroom.data
    || parsed.data.created + parsed.data.updated !== assignments.data.length
    || parsed.data.assignments.length !== assignments.data.length
    || parsed.data.assignments.some((assignment) => assignment.classroom_id !== classroom.data)
  ) {
    throw new ApiError(503, 'Unable to verify assignment bulk save')
  }

  const createdAssignments = parsed.data.assignments.slice(0, parsed.data.created)
  const updatedAssignments = parsed.data.assignments.slice(parsed.data.created)
  const expectedUpdatedIds = assignments.data
    .filter((assignment) => assignment.id)
    .map((assignment) => assignment.id)
  if (
    createdAssignments.some((assignment) => assignment.created_by !== actor.data)
    || updatedAssignments.some((assignment, index) => assignment.id !== expectedUpdatedIds[index])
  ) {
    throw new ApiError(503, 'Unable to verify assignment bulk save')
  }

  return {
    ok: true,
    created: parsed.data.created,
    updated: parsed.data.updated,
    assignments: parsed.data.assignments as TableRow<'assignments'>[],
  }
}
