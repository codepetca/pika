import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import { extractCourseGuideImportDraft } from '@/lib/server/course-guide-import'
import { acquireCourseGuideImportExtractionSlot } from '@/lib/server/course-guide-import-rate-limit'
import { createCourseGuideImportProvenanceToken } from '@/lib/server/course-guide-import-provenance'
import {
  courseGuideImportMetadataSchema,
  decodeCourseGuideImportFormData,
} from '@/lib/validations/course-guide-import'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostCourseGuideCurriculumImportDraft', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: classroomId } = await context.params
  const ownership = await assertTeacherCanMutateClassroom(user.id, classroomId)
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  }

  const formData = await request.formData()
  const sourceType = formData.get('sourceType')
  const sourceUrl = formData.get('sourceUrl')
  const metadata = courseGuideImportMetadataSchema.parse({
    sourceType,
    sourceUrl: typeof sourceUrl === 'string' ? sourceUrl : '',
  })
  const source = await decodeCourseGuideImportFormData(formData, metadata)
  const releaseExtractionSlot = acquireCourseGuideImportExtractionSlot({
    teacherId: user.id,
    classroomId,
  })
  try {
    const draft = await extractCourseGuideImportDraft(source)
    const provenanceToken = createCourseGuideImportProvenanceToken({
      teacherId: user.id,
      classroomId,
      draft,
    })
    return NextResponse.json({ draft, provenanceToken })
  } catch (error) {
    console.error('Course guide curriculum extraction failed:', error instanceof Error ? error.message : error)
    return NextResponse.json({
      error: 'Pika could not extract this curriculum source. Try another PDF or a direct public document link.',
    }, { status: 422 })
  } finally {
    releaseExtractionSlot()
  }
})
