import { z } from 'zod'

import { ApiError } from '@/lib/api-error'
import { isRetryableDatabaseContention } from '@/lib/server/database-contention'
import type { Json } from '@/types/database.generated'

const canonicalUuid = z.string().uuid().transform((value) => value.toLowerCase())
const reorderResultSchema = z.object({
  ok: z.literal(true),
  actor_id: canonicalUuid,
  classroom_id: canonicalUuid,
}).strict()

type RpcError = { code?: string; message?: string }

type AssignmentReorderClient = {
  rpc: (
    name: 'reorder_assignments_for_owner_v1',
    args: {
      p_actor_id: string
      p_classroom_id: string
      p_assignment_ids: Json
    },
  ) => PromiseLike<{ data: unknown; error: RpcError | null }>
}

type MixedClassworkReorderClient = {
  rpc: (
    name: 'reorder_classwork_items_for_owner_v1',
    args: {
      p_actor_id: string
      p_classroom_id: string
      p_items: Json
    },
  ) => PromiseLike<{ data: unknown; error: RpcError | null }>
}

export type ContextualClassworkReorderItem = {
  type: 'assignment' | 'material' | 'survey'
  id: string
}

function parseContext(actorId: string, classroomId: string) {
  const actor = canonicalUuid.safeParse(actorId)
  const classroom = canonicalUuid.safeParse(classroomId)
  if (!actor.success || !classroom.success) {
    throw new ApiError(400, 'Invalid classwork reorder request')
  }
  return { actorId: actor.data, classroomId: classroom.data }
}

function mapReorderError(error: RpcError): never {
  if (error.code === 'P0002') throw new ApiError(404, 'Classroom not found')
  if (error.code === '42501') throw new ApiError(403, 'Unauthorized')
  if (error.code === '55000' && error.message === 'classwork_reorder_archived') {
    throw new ApiError(403, 'Classroom is archived')
  }
  if (error.message === 'Assignment list changed. Refresh and try again.'
    || error.message === 'Classwork list changed. Refresh and try again.'
    || error.code === '40001'
    || isRetryableDatabaseContention(error)
  ) {
    throw new ApiError(409, error.message?.endsWith('Refresh and try again.')
      ? error.message
      : 'Classroom changed during this update. Refresh and try again.')
  }
  if (error.code === '22023'
    || error.code === '22P02'
    || error.message === 'One or more assignments not found in classroom'
    || error.message === 'One or more classwork items not found in classroom'
  ) {
    throw new ApiError(400, error.message ?? 'Invalid classwork reorder request')
  }
  throw new ApiError(503, 'Unable to reorder classwork')
}

function assertResult(data: unknown, context: { actorId: string; classroomId: string }) {
  const parsed = reorderResultSchema.safeParse(data)
  if (!parsed.success
    || parsed.data.actor_id !== context.actorId
    || parsed.data.classroom_id !== context.classroomId
  ) {
    throw new ApiError(503, 'Unable to verify classwork reorder')
  }
}

export async function reorderAssignmentsForOwner(input: {
  supabase: AssignmentReorderClient
  actorId: string
  classroomId: string
  assignmentIds: string[]
}): Promise<void> {
  const context = parseContext(input.actorId, input.classroomId)
  const { data, error } = await input.supabase.rpc('reorder_assignments_for_owner_v1', {
    p_actor_id: context.actorId,
    p_classroom_id: context.classroomId,
    p_assignment_ids: input.assignmentIds,
  })
  if (error) mapReorderError(error)
  assertResult(data, context)
}

export async function reorderClassworkForOwner(input: {
  supabase: MixedClassworkReorderClient
  actorId: string
  classroomId: string
  items: ContextualClassworkReorderItem[]
}): Promise<void> {
  const context = parseContext(input.actorId, input.classroomId)
  const { data, error } = await input.supabase.rpc('reorder_classwork_items_for_owner_v1', {
    p_actor_id: context.actorId,
    p_classroom_id: context.classroomId,
    p_items: input.items,
  })
  if (error) mapReorderError(error)
  assertResult(data, context)
}
