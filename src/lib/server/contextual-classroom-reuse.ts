import { ApiError } from '@/lib/api-error'
import { requireAuth, requireRole } from '@/lib/auth'
import { isClassroomExperienceAdmissionConfigured, resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'
import type { getServiceRoleClient } from '@/lib/supabase'
import { contextualClassroomReuseProposalBindingSchema as reuseProposalBindingSchema } from '@/lib/validations/contextual-classroom-reuse'

/** Admission selects this workflow; ownership and writer invariants remain separate. */
export async function authorizeClassroomReuseActor() {
  if (isClassroomExperienceAdmissionConfigured()) {
    const user = await requireAuth()
    if (resolveClassroomExperienceAdmission(user).status === 'admitted') {
      return { user, contextual: true }
    }
  }
  return { user: await requireRole('teacher'), contextual: false }
}

export function isContextualReuseProposal(proposal: unknown): boolean {
  return reuseProposalBindingSchema.safeParse(proposal).success
}

/** Use the persisted source identity, never a caller-supplied replacement. */
export async function assertContextualReuseProposal(
  supabase: ReturnType<typeof getServiceRoleClient>, actorId: string, blueprintId: string, proposal: unknown,
  options: { allowActiveLegacy?: boolean } = {},
) {
  const parsed = reuseProposalBindingSchema.safeParse(proposal)
  if (!parsed.success || parsed.data.teacher_id !== actorId || parsed.data.course_blueprint_id !== blueprintId) {
    throw new ApiError(403, 'Forbidden')
  }
  const { data, error } = await supabase.from('classrooms')
    .select('id,teacher_id,archived_at,source_blueprint_id')
    .eq('id', parsed.data.source_classroom_id).eq('teacher_id', actorId).single()
  if (error) throw new ApiError(503, 'Unable to verify archived classroom source')
  if (!data || data.id !== parsed.data.source_classroom_id || data.teacher_id !== actorId
    || (!data.archived_at && !options.allowActiveLegacy) || data.source_blueprint_id !== blueprintId) throw new ApiError(403, 'Forbidden')
}

/** Batch source checks keep proposal listing bounded and avoid per-row queries. */
export async function filterContextualReuseProposals<T>(
  supabase: ReturnType<typeof getServiceRoleClient>, actorId: string, blueprintId: string, proposals: T[],
): Promise<T[]> {
  const candidates = proposals.flatMap((proposal) => {
    const parsed = reuseProposalBindingSchema.safeParse(proposal)
    return parsed.success && parsed.data.teacher_id === actorId && parsed.data.course_blueprint_id === blueprintId
      ? [{ proposal, classroomId: parsed.data.source_classroom_id }] : []
  })
  if (candidates.length === 0) return []
  const { data, error } = await supabase.from('classrooms')
    .select('id,teacher_id,archived_at,source_blueprint_id')
    .in('id', [...new Set(candidates.map(({ classroomId }) => classroomId))]).eq('teacher_id', actorId)
  if (error) throw new ApiError(503, 'Unable to verify archived classroom sources')
  const allowed = new Set((data || []).filter((row) => row.teacher_id === actorId
    && row.archived_at && row.source_blueprint_id === blueprintId).map((row) => row.id))
  return candidates.filter(({ classroomId }) => allowed.has(classroomId)).map(({ proposal }) => proposal)
}
