import { z } from 'zod'
import { ApiError } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'

const acquisitionResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    lease_token: z.string().uuid(),
    lease_expires_at: z.string().datetime({ offset: true }),
  }),
  z.object({
    ok: z.literal(false),
    reason: z.enum(['active', 'rate_limited']),
  }),
])

type AdmissionClient = Pick<ReturnType<typeof getServiceRoleClient>, 'rpc'>

/** Reserve a paid provider call in the database before invoking the model. */
export async function acquireCourseBlueprintDraftSlot(args: {
  teacherId: string
  supabase?: AdmissionClient
}): Promise<() => Promise<void>> {
  const supabase = args.supabase ?? getServiceRoleClient()
  const { data, error } = await supabase.rpc('acquire_course_blueprint_draft_slot', {
    p_teacher_id: args.teacherId,
  })

  const parsed = acquisitionResultSchema.safeParse(data)
  if (error || !parsed.success) {
    console.error('Blueprint draft admission failed:', error || parsed.error)
    throw new ApiError(503, 'AI drafting is temporarily unavailable.')
  }

  if (!parsed.data.ok) {
    if (parsed.data.reason === 'active') {
      throw new ApiError(429, 'An AI draft is already running for this teacher.')
    }
    throw new ApiError(429, 'Too many AI drafts. Try again in a few minutes.')
  }

  const leaseToken = parsed.data.lease_token
  return async () => {
    const { error: releaseError } = await supabase.rpc('release_course_blueprint_draft_slot', {
      p_teacher_id: args.teacherId,
      p_lease_token: leaseToken,
    })
    if (releaseError) {
      console.error('Blueprint draft slot release failed:', releaseError)
    }
  }
}
