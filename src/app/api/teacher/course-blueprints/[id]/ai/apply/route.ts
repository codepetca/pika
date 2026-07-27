import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { courseBlueprintAiApplySchema } from '@/lib/validations/course-blueprints'
import { getCourseBlueprintDetail } from '@/lib/server/course-blueprints'
import { getServiceRoleClient } from '@/lib/supabase'
import {
  buildCourseBlueprintAiCandidate,
  submitCourseBlueprintProposal,
} from '@/lib/server/course-blueprint-proposals'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostTeacherCourseBlueprintAiApply', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const { target, content } = courseBlueprintAiApplySchema.parse(await request.json())
  const detailResult = await getCourseBlueprintDetail(user.id, id)

  if (!detailResult.detail) {
    return NextResponse.json({ error: detailResult.error }, { status: detailResult.status || 500 })
  }
  if (detailResult.detail.authority_mode === 'repository') {
    return NextResponse.json(
      { error: 'This Blueprint is repository-managed and accepts repository proposals only' },
      { status: 409 }
    )
  }

  const candidate = buildCourseBlueprintAiCandidate(detailResult.detail, target, content)
  if (!candidate.ok) {
    return NextResponse.json(
      { error: candidate.error, errors: candidate.errors },
      { status: candidate.status }
    )
  }
  const result = await submitCourseBlueprintProposal({
    supabase: getServiceRoleClient() as any,
    teacherId: user.id,
    base: candidate.base,
    candidate: candidate.candidate,
    source: 'ai',
    idempotencyKey: crypto.randomUUID(),
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(
    { proposal: result.proposal, warnings: candidate.warnings },
    { status: 201 }
  )
})
