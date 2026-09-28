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
import { resolveCourseBlueprintAuthoringContext } from '@/lib/course-blueprint-authoring-context'
import { verifyCourseBlueprintDraftProvenanceToken } from '@/lib/server/course-blueprint-draft-provenance'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostTeacherCourseBlueprintAiApply', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const { target, content, original_content_sha256, draft_provenance_token, expected_blueprint_revision, unit_exception_id } = courseBlueprintAiApplySchema.parse(await request.json())
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
  if (expected_blueprint_revision !== undefined
    && detailResult.detail.content_revision !== expected_blueprint_revision) {
    return NextResponse.json(
      { error: 'The Blueprint changed since this preview. Generate a new draft before proposing it.' },
      { status: 409 },
    )
  }
  const guided = target === 'assignments' || target === 'tests'
  if (guided && expected_blueprint_revision === undefined) {
    return NextResponse.json({ error: 'The draft guidance revision is required' }, { status: 400 })
  }
  if (guided && unit_exception_id && !detailResult.detail.authoring_guidance.unit_exceptions.some(
    (unit) => unit.id === unit_exception_id,
  )) {
    return NextResponse.json({ error: 'The selected unit guidance is no longer available' }, { status: 409 })
  }
  const guidanceProvenance = guided ? {
    blueprint_revision: detailResult.detail.content_revision,
    ...resolveCourseBlueprintAuthoringContext({
      guidance: detailResult.detail.authoring_guidance,
      target,
      unitExceptionId: unit_exception_id,
    }),
  } : undefined
  if (guidanceProvenance && (!draft_provenance_token || !original_content_sha256
    || !verifyCourseBlueprintDraftProvenanceToken({
      token: draft_provenance_token,
      teacherId: user.id,
      blueprintId: id,
      provenance: guidanceProvenance,
      generatedContentSha256: original_content_sha256,
    }))) {
    return NextResponse.json(
      { error: 'This draft preview is invalid or expired. Generate a new draft from saved guidance.' },
      { status: 409 },
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
    guidanceProvenance,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(
    { proposal: result.proposal, warnings: candidate.warnings },
    { status: 201 }
  )
})
