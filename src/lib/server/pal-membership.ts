import { ApiError } from '@/lib/api-error'
import { requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import {
  membershipPalReadRequestSchema,
  membershipPalResolutionSchema,
} from '@/lib/validations/pal-membership'

/**
 * Server-only foundation; deliberately has no route, cache, fetch, or token mint.
 * Pal's current mint endpoint provisions identities, so calling it belongs to
 * the separately approved cutover. Every preparation reauthorizes membership.
 */
export async function prepareMembershipPalReadRequest(input: unknown): Promise<{ learner_id: string }> {
  const user = await requireRole('student')
  const { classroomId } = membershipPalReadRequestSchema.parse(input)
  if (process.env.PAL_MEMBERSHIP_IDENTITY_ENABLED !== 'true') {
    throw new ApiError(503, 'Classroom Pal identity is unavailable')
  }

  // Temporary migration-168 boundary until authorized schema replay generates
  // the public RPC type. Remove this adapter before marking the PR ready.
  const client = getServiceRoleClient() as unknown as {
    rpc(name: 'resolve_pal_membership', args: {
      p_student_id: string; p_classroom_id: string
    }): PromiseLike<{ data: unknown; error: unknown }>
  }
  let response: { data: unknown; error: unknown }
  try {
    response = await client.rpc('resolve_pal_membership', {
      p_student_id: user.id,
      p_classroom_id: classroomId,
    })
  } catch {
    throw new ApiError(503, 'Classroom Pal identity is unavailable')
  }
  const { data, error } = response
  const resolution = membershipPalResolutionSchema.safeParse(data)
  if (error || !resolution.success || resolution.data.status === 'disabled') {
    throw new ApiError(503, 'Classroom Pal identity is unavailable')
  }
  if (resolution.data.status === 'forbidden') {
    throw new ApiError(403, 'Classroom Pal access is unavailable')
  }
  return { learner_id: resolution.data.learner_id }
}
