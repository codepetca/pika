import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { getCourseBlueprintDetail } from '@/lib/server/course-blueprints'
import {
  buildCourseBlueprintPackageCandidate,
  submitCourseBlueprintProposal,
} from '@/lib/server/course-blueprint-proposals'
import { resolveBlueprintOperationId } from '@/lib/server/course-blueprint-operations'
import {
  planCourseBlueprintPackageRequest,
  readCourseBlueprintPackageBody,
} from '@/lib/course-blueprint-package-request'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetTeacherCourseBlueprintProposals', async (
  _request,
  context
) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const detailResult = await getCourseBlueprintDetail(user.id, id)
  if (!detailResult.detail) {
    throw new ApiError(detailResult.status || 500, detailResult.error || 'Failed to load Blueprint')
  }

  const { data, error } = await (getServiceRoleClient() as any)
    .from('course_blueprint_change_proposals')
    .select('*')
    .eq('course_blueprint_id', id)
    .eq('teacher_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw new ApiError(500, 'Failed to load Blueprint proposals')
  return NextResponse.json({ proposals: data || [] })
})

export const POST = withErrorHandler('PostTeacherCourseBlueprintProposal', async (
  request,
  context
) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const body = await readCourseBlueprintPackageBody(request)
  const planned = planCourseBlueprintPackageRequest(
    body,
    request.headers.get('content-type'),
  )
  if (!planned.ok) {
    return NextResponse.json({
      error: 'Invalid course package',
      errors: planned.errors,
    }, { status: 400 })
  }
  const detailResult = await getCourseBlueprintDetail(user.id, id)
  if (!detailResult.detail) {
    throw new ApiError(detailResult.status || 500, detailResult.error || 'Failed to load Blueprint')
  }
  if (detailResult.detail.authority_mode !== 'repository') {
    throw new ApiError(
      409,
      'Switch this Blueprint to repository-managed before submitting repository changes'
    )
  }

  const candidateResult = buildCourseBlueprintPackageCandidate(detailResult.detail, planned.plan)
  if (!candidateResult.ok) {
    return NextResponse.json({
      error: candidateResult.error,
      errors: candidateResult.errors,
    }, { status: candidateResult.status })
  }
  if (!candidateResult.editingSessionId) {
    throw new ApiError(
      409,
      'Pull the current Blueprint before pushing changes so Pika can verify the exact source revision'
    )
  }

  const supabase = getServiceRoleClient() as any
  const { data: editingSession, error: editingSessionError } = await supabase
    .from('course_blueprint_editing_sessions')
    .select('*')
    .eq('id', candidateResult.editingSessionId)
    .eq('teacher_id', user.id)
    .eq('course_blueprint_id', id)
    .single()
  if (
    editingSessionError
    || !editingSession
    || !['ready', 'closed'].includes(editingSession.status)
    || new Date(editingSession.expires_at).getTime() <= Date.now()
    || Number(editingSession.base_blueprint_revision)
      !== candidateResult.sourceDraftRevision
    || editingSession.base_blueprint_version_id
      !== candidateResult.baseBlueprintVersionId
  ) {
    throw new ApiError(
      409,
      'Blueprint editing session is stale or invalid; pull the current Blueprint and retry'
    )
  }

  const idempotencyKey = resolveBlueprintOperationId(
    request.headers.get('idempotency-key')
  )
  if (idempotencyKey !== candidateResult.editingSessionId) {
    throw new ApiError(
      409,
      'Use the editing session ID as the proposal idempotency key'
    )
  }
  const result = await submitCourseBlueprintProposal({
    supabase,
    teacherId: user.id,
    base: candidateResult.base,
    candidate: candidateResult.candidate,
    source: 'repository',
    idempotencyKey,
    baseBlueprintVersionId: candidateResult.baseBlueprintVersionId,
    expectedBlueprintRevision: candidateResult.sourceDraftRevision,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  await supabase
    .from('course_blueprint_editing_sessions')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('id', candidateResult.editingSessionId)
    .eq('status', 'ready')

  return NextResponse.json(
    { proposal: result.proposal },
    { status: result.proposal.status === 'stale' ? 409 : 201 }
  )
})
