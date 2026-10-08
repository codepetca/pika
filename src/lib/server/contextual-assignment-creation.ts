import { z } from 'zod'

import { ApiError } from '@/lib/api-error'
import {
  normalizeAssignmentSubmissionRequirementDrafts,
  type AssignmentSubmissionRequirementDraft,
} from '@/lib/assignment-submission-requirements'
import { isRetryableDatabaseContention } from '@/lib/server/database-contention'
import type { AssignmentSubmissionRequirement } from '@/types'
import type { TableRow } from '@/types/database'
import type { Json } from '@/types/database.generated'

const canonicalUuid = z.string().uuid().transform((value) => value.toLowerCase())
const assignmentSchema = z.object({
  id: canonicalUuid,
  classroom_id: canonicalUuid,
  created_by: canonicalUuid,
}).passthrough()
const requirementSchema = z.object({
  id: canonicalUuid,
  assignment_id: canonicalUuid,
}).passthrough()
const creationSuccessSchema = z.object({
  ok: z.literal(true),
  assignment: assignmentSchema,
  submission_requirements: z.array(requirementSchema),
}).strip()

type RpcError = { code?: string; message?: string; details?: string }

export type ContextualAssignmentCreationClient = {
  rpc: (
    name: 'create_assignment_for_owner_v1',
    args: {
      p_actor_id: string
      p_classroom_id: string
      p_title: string
      p_description: string
      p_instructions_markdown: string
      p_rich_instructions: Json
      p_due_at: string
      p_requirements: Json
    },
  ) => PromiseLike<{ data: unknown; error: RpcError | null }>
}

function mapRpcError(error: RpcError): never {
  if (error.code === 'P0002') throw new ApiError(404, 'Classroom not found')
  if (error.code === '42501') throw new ApiError(403, 'Unauthorized')
  if (error.code === '55000') throw new ApiError(403, 'Classroom is archived')
  if (isRetryableDatabaseContention(error)) {
    throw new ApiError(409, 'Classroom changed during this update. Refresh and try again.')
  }
  if (error.code === '22023' || error.code === '22P02' || error.code === '23502') {
    throw new ApiError(400, 'Invalid assignment creation request')
  }
  throw new ApiError(503, 'Unable to create assignment')
}

export async function createAssignmentForOwner(input: {
  supabase: ContextualAssignmentCreationClient
  actorId: string
  classroomId: string
  title: string
  description: string
  instructionsMarkdown: string
  richInstructions: Json
  dueAt: string
  requirements?: AssignmentSubmissionRequirementDraft[]
}): Promise<{
  assignment: TableRow<'assignments'>
  submissionRequirements: AssignmentSubmissionRequirement[]
}> {
  const actor = canonicalUuid.safeParse(input.actorId)
  const classroom = canonicalUuid.safeParse(input.classroomId)
  if (!actor.success || !classroom.success) {
    throw new ApiError(400, 'Invalid assignment creation request')
  }
  const requirements = normalizeAssignmentSubmissionRequirementDrafts(input.requirements ?? [])
  const { data, error } = await input.supabase.rpc('create_assignment_for_owner_v1', {
    p_actor_id: actor.data,
    p_classroom_id: classroom.data,
    p_title: input.title,
    p_description: input.description,
    p_instructions_markdown: input.instructionsMarkdown,
    p_rich_instructions: input.richInstructions,
    p_due_at: input.dueAt,
    p_requirements: requirements as Json,
  })
  if (error) mapRpcError(error)

  const parsed = creationSuccessSchema.safeParse(data)
  if (
    !parsed.success
    || parsed.data.assignment.classroom_id !== classroom.data
    || parsed.data.assignment.created_by !== actor.data
    || parsed.data.submission_requirements.some((row) => (
      row.assignment_id !== parsed.data.assignment.id
    ))
  ) {
    throw new ApiError(503, 'Unable to verify assignment creation')
  }

  return {
    assignment: parsed.data.assignment as TableRow<'assignments'>,
    submissionRequirements: parsed.data.submission_requirements as unknown as AssignmentSubmissionRequirement[],
  }
}
