import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { getCourseBlueprintDetail } from '@/lib/server/course-blueprints'
import {
  applyPersistedClassroomBlueprintProposal,
  applyPersistedCourseBlueprintProposal,
  type CourseBlueprintProposalRecord,
} from '@/lib/server/course-blueprint-proposals'
import type { CourseBlueprintSnapshot } from '@/lib/server/course-blueprint-versions'
import { classroomBlueprintUpdateWritePlanSchema } from '@/lib/server/course-blueprint-operations'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostTeacherCourseBlueprintProposalApply', async (
  _request,
  context
) => {
  const user = await requireRole('teacher')
  const { id, proposalId } = await context.params
  const detailResult = await getCourseBlueprintDetail(user.id, id)
  if (!detailResult.detail) {
    throw new ApiError(detailResult.status || 500, detailResult.error || 'Failed to load Blueprint')
  }

  const supabase = getServiceRoleClient() as any
  const { data, error } = await supabase
    .from('course_blueprint_change_proposals')
    .select('*')
    .eq('id', proposalId)
    .eq('course_blueprint_id', id)
    .eq('teacher_id', user.id)
    .single()
  if (error?.code === 'PGRST116' || !data) throw new ApiError(404, 'Blueprint proposal not found')
  if (error) throw new ApiError(500, 'Failed to load Blueprint proposal')

  const proposal = data as unknown as CourseBlueprintProposalRecord
  if (proposal.target_kind === 'classroom') {
    const plan = classroomBlueprintUpdateWritePlanSchema.safeParse(
      proposal.diff_json.classroom_plan,
    )
    if (!plan.success) {
      throw new ApiError(409, 'Classroom proposal has no valid reviewed write plan')
    }
    const result = await applyPersistedClassroomBlueprintProposal({
      supabase,
      teacherId: user.id,
      proposalId,
      plan: plan.data,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(
      {
        proposal: result.proposal,
        ...(result.proposal.status === 'stale'
          ? { error: 'Classroom proposal is stale; review it again against the current classroom' }
          : {}),
      },
      { status: result.proposal.status === 'stale' ? 409 : 200 },
    )
  }
  const candidate = proposal.diff_json.candidate_snapshot as CourseBlueprintSnapshot | undefined
  if (!candidate) throw new ApiError(409, 'Blueprint proposal has no reviewed candidate snapshot')

  const result = await applyPersistedCourseBlueprintProposal({
    supabase,
    teacherId: user.id,
    proposalId,
    candidate,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(
    {
      proposal: result.proposal,
      ...(result.proposal.status === 'stale'
        ? { error: 'Blueprint proposal is stale; rebuild it against the current Draft' }
        : {}),
    },
    { status: result.proposal.status === 'stale' ? 409 : 200 }
  )
})
