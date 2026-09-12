import { z } from 'zod'

import { ApiError } from '@/lib/api-error'
import { getServiceRoleClient } from '@/lib/supabase'
import { isClassroomPalEnabled } from '@/lib/server/pal-config'
import { classroomPalRpc } from '@/lib/server/pal-classroom-rpc'
import { getPalReadTokenForMembership, type PalReadToken } from '@/lib/server/pal-read-token'

const contextSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('disabled') }).strict(),
  z.object({ status: z.literal('forbidden') }).strict(),
  z.object({
    status: z.literal('active'),
    generation_id: z.string().uuid(),
    learner_id: z.string().regex(/^pika-membership-v1-[0-9a-f]{32}$/),
    scope_key: z.string().regex(/^pika-classroom-v1-[0-9a-f]{64}$/),
  }).strict(),
])
type ActiveContext = Extract<z.infer<typeof contextSchema>, { status: 'active' }>
type MembershipInput = { studentId: string; classroomId: string }

/** The student ID is supplied by the authenticated server caller, never a browser body. */
export async function resolvePalClassroomContext(input: MembershipInput): Promise<ActiveContext> {
  if (!isClassroomPalEnabled()) throw unavailable()
  let response: { data: unknown; error: unknown }
  try {
    response = await classroomPalRpc(getServiceRoleClient(), 'resolve_pal_classroom_context', {
      p_student_id: input.studentId, p_classroom_id: input.classroomId,
    })
  } catch { throw unavailable() }
  const parsed = contextSchema.safeParse(response.data)
  if (response.error || !parsed.success || parsed.data.status === 'disabled') throw unavailable()
  if (parsed.data.status === 'forbidden') throw forbidden()
  return parsed.data
}

function unavailable() { return new ApiError(503, 'Classroom achievements are unavailable') }
function forbidden() { return new ApiError(403, 'Classroom achievements access is unavailable') }

export function createMembershipPalReadTokenCoordinator(options: {
  resolve?: (input: MembershipInput) => Promise<ActiveContext>
  mint?: (input: { learnerReference: string }) => Promise<PalReadToken>
} = {}) {
  const resolve = options.resolve ?? resolvePalClassroomContext
  const mint = options.mint ?? getPalReadTokenForMembership
  return async (input: MembershipInput & { scopeKey: string }) => {
    const before = await resolve(input)
    if (before.scope_key !== input.scopeKey) throw forbidden()
    const token = await mint({ learnerReference: before.learner_id })
    const after = await resolve(input)
    if (before.generation_id !== after.generation_id || before.learner_id !== after.learner_id
      || before.scope_key !== after.scope_key) throw forbidden()
    // This drops an in-flight result on observed removal; it cannot revoke a
    // provider-issued token. That provider boundary remains a Phase 3 gate.
    return { ...token, scope_key: after.scope_key }
  }
}

export const getMembershipPalReadToken = createMembershipPalReadTokenCoordinator()

export async function recordPalClassroomVisit(input: MembershipInput): Promise<void> {
  if (!isClassroomPalEnabled()) throw unavailable()
  const { data, error } = await classroomPalRpc(getServiceRoleClient(), 'record_pal_classroom_visit', {
    p_student_id: input.studentId, p_classroom_id: input.classroomId,
  })
  const parsed = z.object({ status: z.enum(['recorded', 'disabled', 'forbidden']) }).strict().safeParse(data)
  if (error || !parsed.success || parsed.data.status === 'disabled') throw unavailable()
  if (parsed.data.status === 'forbidden') throw forbidden()
}
