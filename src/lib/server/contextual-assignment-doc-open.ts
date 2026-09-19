import { z } from 'zod'

import { ApiError } from '@/lib/api-error'
import type { Json } from '@/types/database.generated'
import type { v1 } from '@/vendor/pal-contract'

const canonicalUuid = z.string().uuid().transform((value) => value.toLowerCase())
const timestamp = z.string().datetime({ offset: true })
const resultSchema = z.object({
  ok: z.literal(true),
  created: z.boolean(),
  viewed_at_changed: z.boolean(),
  assignment: z.object({
    id: canonicalUuid,
    classroom_id: canonicalUuid,
    is_draft: z.literal(false),
    created_at: timestamp,
    released_at: timestamp.nullable(),
  }).passthrough(),
  doc: z.object({
    id: canonicalUuid,
    assignment_id: canonicalUuid,
    student_id: canonicalUuid,
    viewed_at: timestamp.nullable(),
  }).passthrough(),
}).strict()

export type ContextualAssignmentDocOpenClient = {
  rpc: (
    name: 'open_assignment_doc_for_member_v1',
    args: {
      p_actor_id: string
      p_assignment_id: string
      p_viewed_at: string
      p_pal_event: Json | null
    },
  ) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>
}

function mapRpcError(code: string | undefined): never {
  if (code === 'P0002') throw new ApiError(404, 'Assignment not found')
  if (code === '42501') throw new ApiError(403, 'Forbidden')
  if (code === '22023' || code === '22007' || code === '22008') {
    throw new ApiError(400, 'Invalid assignment open request')
  }
  if (code === '40001') throw new ApiError(409, 'Assignment access changed. Refresh and try again.')
  // Missing migration, malformed database evidence, transport failures, and
  // unexpected constraints all fail closed without exposing database details.
  throw new ApiError(503, 'Unable to open assignment')
}

/**
 * Dormant adapter for the service-only transactional assignment-open boundary.
 * The actor and assignment IDs must come from authenticated route state, never
 * request JSON. No production route calls this helper in migration 182's slice.
 */
export async function openContextualAssignmentDoc(input: {
  supabase: ContextualAssignmentDocOpenClient
  actorId: string
  assignmentId: string
  viewedAt: string
  event: v1.LearningItemViewedEvent | null
}) {
  const actorId = canonicalUuid.safeParse(input.actorId)
  const assignmentId = canonicalUuid.safeParse(input.assignmentId)
  const viewedAt = timestamp.safeParse(input.viewedAt)
  if (!actorId.success || !assignmentId.success || !viewedAt.success) {
    throw new ApiError(400, 'Invalid assignment open request')
  }

  const { data, error } = await input.supabase.rpc('open_assignment_doc_for_member_v1', {
    p_actor_id: actorId.data,
    p_assignment_id: assignmentId.data,
    p_viewed_at: viewedAt.data,
    p_pal_event: input.event as unknown as Json | null,
  })
  if (error) mapRpcError(error.code)

  const parsed = resultSchema.safeParse(data)
  if (
    !parsed.success
    || parsed.data.assignment.id !== assignmentId.data
    || parsed.data.doc.assignment_id !== assignmentId.data
    || parsed.data.doc.student_id !== actorId.data
    || (parsed.data.created && !parsed.data.viewed_at_changed)
    || (
      parsed.data.viewed_at_changed
      && new Date(parsed.data.doc.viewed_at ?? '').getTime() !== new Date(viewedAt.data).getTime()
    )
  ) {
    throw new ApiError(503, 'Unable to verify assignment access')
  }

  return parsed.data
}
