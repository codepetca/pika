import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { getCourseBlueprintDetail } from '@/lib/server/course-blueprints'
import { loadClassroomBlueprintSource } from '@/lib/server/classroom-blueprint-source'
import {
  buildClassroomCourseBlueprintSnapshot,
  countUntrackedClassroomBlueprintArtifacts,
  submitClassroomBlueprintProposal,
} from '@/lib/server/course-blueprint-proposals'
import {
  buildClassroomBlueprintUpdateWritePlan,
  resolveBlueprintOperationId,
} from '@/lib/server/course-blueprint-operations'
import { saveCourseBlueprintVersion } from '@/lib/server/course-blueprint-versions'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const inputSchema = z.object({
  classroom_id: z.string().uuid(),
}).strict()

export const POST = withErrorHandler(
  'PostTeacherCourseBlueprintClassroomProposal',
  async (request, context) => {
    const user = await requireRole('teacher')
    const { id } = await context.params
    const input = inputSchema.parse(await request.json())
    const detailResult = await getCourseBlueprintDetail(user.id, id)
    if (!detailResult.detail) {
      throw new ApiError(
        detailResult.status || 500,
        detailResult.error || 'Failed to load Blueprint',
      )
    }
    if (
      !detailResult.detail.linked_classrooms.some(
        (classroom) => classroom.id === input.classroom_id,
      )
    ) {
      throw new ApiError(404, 'Linked classroom not found')
    }

    const supabase = getServiceRoleClient() as any
    const [sourceResult, classDaysResult] = await Promise.all([
      loadClassroomBlueprintSource(user.id, input.classroom_id, {
        lessonTemplateTitleMode: 'generic',
      }),
      supabase
        .from('class_days')
        .select('date')
        .eq('classroom_id', input.classroom_id)
        .order('date', { ascending: true }),
    ])
    if (!sourceResult.ok) {
      throw new ApiError(sourceResult.status, sourceResult.error)
    }
    if (classDaysResult.error) {
      throw new ApiError(500, 'Failed to load classroom calendar')
    }
    if (!sourceResult.source.classroom.start_date) {
      throw new ApiError(409, 'Classroom needs a start date before it can receive Blueprint timing')
    }
    const untrackedArtifactCount = countUntrackedClassroomBlueprintArtifacts(
      sourceResult.source,
    )
    if (untrackedArtifactCount > 0) {
      throw new ApiError(
        409,
        'Save or reconcile new classroom artifacts with this Blueprint before preparing a classroom update',
      )
    }

    const versionResult = await saveCourseBlueprintVersion({
      supabase,
      teacherId: user.id,
      detail: detailResult.detail,
      sourceKind:
        detailResult.detail.authority_mode === 'repository'
          ? 'repository'
          : 'pika',
      sourceMetadata: {
        reason: 'classroom_update_proposal',
        target_classroom_id: input.classroom_id,
      },
    })
    if (!versionResult.ok) {
      throw new ApiError(versionResult.status, versionResult.error)
    }

    const base = buildClassroomCourseBlueprintSnapshot({
      source: sourceResult.source,
      blueprintId: id,
      blueprintRevision: detailResult.detail.content_revision,
      candidate: versionResult.snapshot,
      trackedOnly: true,
    })
    const plan = buildClassroomBlueprintUpdateWritePlan({
      snapshot: versionResult.snapshot,
      classroomStartDate: sourceResult.source.classroom.start_date,
      classDayDates: (classDaysResult.data || []).map(
        (day: { date: string }) => day.date,
      ),
    })
    const result = await submitClassroomBlueprintProposal({
      supabase,
      teacherId: user.id,
      blueprintId: id,
      blueprintRevision: detailResult.detail.content_revision,
      blueprintVersionId: versionResult.version.id,
      classroomId: input.classroom_id,
      classroomRevision:
        sourceResult.source.classroom.blueprint_source_revision,
      base,
      candidate: versionResult.snapshot,
      plan,
      idempotencyKey: resolveBlueprintOperationId(
        request.headers.get('idempotency-key'),
      ),
    })
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      )
    }
    return NextResponse.json(
      { proposal: result.proposal },
      { status: result.proposal.status === 'stale' ? 409 : 201 },
    )
  },
)
