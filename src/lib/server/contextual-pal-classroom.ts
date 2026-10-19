import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { isClassroomExperienceAdmissionConfigured, resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'
import { isClassroomPalEnabled } from '@/lib/server/pal-config'
import { createMembershipPalReadTokenCoordinator } from '@/lib/server/pal-classroom'

const contextSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('disabled') }).strict(),
  z.object({ status: z.literal('forbidden') }).strict(),
  z.object({ status: z.literal('active'), generation_id: z.string().uuid(),
    learner_id: z.string().regex(/^pika-membership-v1-[0-9a-f]{32}$/),
    scope_key: z.string().regex(/^pika-classroom-v1-[0-9a-f]{64}$/) }).strict(),
])
const visitSchema = z.object({ status: z.enum(['recorded', 'disabled', 'forbidden']) }).strict()
const inputSchema = z.object({ studentId: z.string().uuid(), classroomId: z.string().uuid() })
type MembershipInput = z.infer<typeof inputSchema>
type ContextualPalRpc = 'resolve_pal_classroom_context_for_member_v1' | 'record_pal_classroom_visit_for_member_v1'
// Isolated until migration272 is replayed and the coordinator generates DB types.
type ContextualPalClient = {
  rpc(name: ContextualPalRpc, args: { p_actor_id: string; p_classroom_id: string }): {
    abortSignal(signal: AbortSignal): PromiseLike<unknown>
  }
}
const sdkEnvelopeSchema = z.object({
  data: z.unknown(),
  error: z.object({ code: z.string(), message: z.string(), details: z.string().nullable(), hint: z.string().nullable() }).strict().nullable(),
  status: z.number().int().min(100).max(599), statusText: z.string(),
  count: z.number().int().nonnegative().nullable(),
}).strict()
const unavailable = () => new ApiError(503, 'Classroom achievements are unavailable')
const forbidden = () => new ApiError(403, 'Classroom achievements access is unavailable')

export async function authorizeSharedPalClassroomActor() {
  if (!isClassroomExperienceAdmissionConfigured()) return { mode: 'existing' as const }
  const user = await requireAuth()
  return resolveClassroomExperienceAdmission(user).status === 'admitted'
    ? { mode: 'shared' as const, user } : { mode: 'existing' as const }
}

async function invoke(name: ContextualPalRpc, input: MembershipInput): Promise<unknown> {
  if (!isClassroomPalEnabled()) throw unavailable()
  const parsedInput = inputSchema.safeParse(input)
  if (!parsedInput.success) throw new ApiError(400, 'Invalid classroom achievements request')
  let raw: unknown
  try {
    const client = getServiceRoleClient() as unknown as ContextualPalClient
    raw = await client.rpc(name, { p_actor_id: parsedInput.data.studentId, p_classroom_id: parsedInput.data.classroomId })
      .abortSignal(AbortSignal.timeout(10_000))
  } catch { throw unavailable() }
  if (!raw || typeof raw !== 'object' || !Object.hasOwn(raw, 'data') || !Object.hasOwn(raw, 'error')) throw unavailable()
  const result = sdkEnvelopeSchema.safeParse(raw)
  if (!result.success) throw unavailable()
  if (result.data.error !== null) {
    if (result.data.data === null && result.data.count === null && result.data.status === 409 && result.data.error.code === 'PT409') {
      throw new ApiError(409, 'Classroom achievements changed; retry')
    }
    throw unavailable()
  }
  if (result.data.status < 200 || result.data.status > 299 || (result.data.count !== null && result.data.count !== 1)) throw unavailable()
  return result.data.data
}

/** Exact current nonowner membership, never an account profile fallback. */
export async function resolveContextualPalClassroomContext(input: MembershipInput) {
  const parsed = contextSchema.safeParse(await invoke('resolve_pal_classroom_context_for_member_v1', input))
  if (!parsed.success || parsed.data.status === 'disabled') throw unavailable()
  if (parsed.data.status === 'forbidden') throw forbidden()
  return parsed.data
}

export const getContextualPalReadToken = createMembershipPalReadTokenCoordinator({ resolve: resolveContextualPalClassroomContext })

export async function recordContextualPalClassroomVisit(input: MembershipInput): Promise<void> {
  const parsed = visitSchema.safeParse(await invoke('record_pal_classroom_visit_for_member_v1', input))
  if (!parsed.success || parsed.data.status === 'disabled') throw unavailable()
  if (parsed.data.status === 'forbidden') throw forbidden()
}
