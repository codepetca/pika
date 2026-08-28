import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { addCourseGuideImportCitation, appendCourseGuideImport } from '@/lib/course-guide-import'
import {
  assertTeacherCanMutateClassroom,
  hydrateClassroomRecord,
} from '@/lib/server/classrooms'
import { verifyCourseGuideImportProvenanceToken } from '@/lib/server/course-guide-import-provenance'
import { getServiceRoleClient } from '@/lib/supabase'
import { applyCourseGuideImportSchema } from '@/lib/validations/course-guide-import'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostApplyCourseGuideCurriculumImport', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: classroomId } = await context.params
  const supabase = getServiceRoleClient()
  const ownership = await assertTeacherCanMutateClassroom(user.id, classroomId, { supabase })
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  }
  const input = applyCourseGuideImportSchema.parse(await request.json())
  const provenance = verifyCourseGuideImportProvenanceToken({
    token: input.provenanceToken,
    teacherId: user.id,
    classroomId,
  })
  if (!provenance) {
    return NextResponse.json({
      error: 'This curriculum draft has expired or is no longer valid. Create a new draft and try again.',
    }, { status: 409 })
  }

  const nextOverview = appendCourseGuideImport(
    input.expectedOverviewMarkdown,
    addCourseGuideImportCitation({
      reviewedDraftMarkdown: input.draftMarkdown,
      citationMarkdown: provenance.citationMarkdown,
    }),
  )
  const { data: classroom, error } = await supabase
    .from('classrooms')
    .update({
      course_overview_markdown: nextOverview,
      updated_at: new Date().toISOString(),
    })
    .eq('id', classroomId)
    .eq('course_overview_markdown', input.expectedOverviewMarkdown)
    .select()
    .maybeSingle()

  if (error) {
    console.error('Course guide curriculum import apply failed:', error)
    return NextResponse.json({ error: 'The reviewed curriculum draft could not be added' }, { status: 500 })
  }
  if (!classroom) {
    return NextResponse.json({
      error: 'The Course Guide changed while you were reviewing. Reopen the import assistant and try again.',
    }, { status: 409 })
  }

  return NextResponse.json({
    classroom: hydrateClassroomRecord(classroom as Record<string, unknown>),
  })
})
