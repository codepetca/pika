import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherOwnsClassroom } from '@/lib/server/classrooms'
import { classroomGuidedDraftProvenanceQuerySchema } from '@/lib/validations/classroom-guided-drafts'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetTeacherClassroomAuthoringDraftProvenance', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const query = classroomGuidedDraftProvenanceQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  )
  const supabase = getServiceRoleClient()
  const ownership = await assertTeacherOwnsClassroom(user.id, id, { supabase })
  if (!ownership.ok) return NextResponse.json({ error: ownership.error }, { status: ownership.status })

  const artifactColumn = query.target === 'tests' ? 'test_id' : 'assignment_id'
  const { data, error } = await (supabase as any)
    .from('classroom_guided_draft_provenance')
    .select('source_blueprint_version_number,unit_label')
    .eq('classroom_id', id)
    .eq(artifactColumn, query.artifact_id)
    .maybeSingle()
  if (error) {
    console.error('Failed to load classroom draft provenance:', error)
    return NextResponse.json({ error: 'Failed to load authoring source' }, { status: 500 })
  }
  return NextResponse.json({ provenance: data ? {
    source_blueprint_version_number: data.source_blueprint_version_number,
    unit_label: data.unit_label,
    target: query.target,
  } : null })
})
