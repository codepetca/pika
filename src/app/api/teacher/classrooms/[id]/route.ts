import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertTeacherOwnsClassroom, hydrateClassroomRecord } from '@/lib/server/classrooms'
import { withErrorHandler } from '@/lib/api-handler'
import { getNextTeacherClassroomPosition } from '@/lib/server/classroom-order'
import { updateClassroomPublishingSchema } from '@/lib/validations/teacher'
import { normalizeActualCourseSiteConfig } from '@/lib/course-site-publishing'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/teacher/classrooms/[id] - Get classroom details
export const GET = withErrorHandler('GetClassroomById', async (_request, context) => {
  const user = await requireRole('teacher')
  const { id: classroomId } = await context.params

  const supabase = getServiceRoleClient()

  const { data: classroom, error: fetchError } = await supabase
    .from('classrooms')
    .select('*')
    .eq('id', classroomId)
    .single()

  if (fetchError || !classroom) {
    return NextResponse.json(
      { error: 'Classroom not found' },
      { status: 404 }
    )
  }

  if (classroom.teacher_id !== user.id) {
    return NextResponse.json(
      { error: 'Forbidden' },
      { status: 403 }
    )
  }

  return NextResponse.json({ classroom: hydrateClassroomRecord(classroom as Record<string, any>) })
})

// PATCH /api/teacher/classrooms/[id] - Update classroom
export const PATCH = withErrorHandler('PatchUpdateClassroom', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: classroomId } = await context.params

  const body = updateClassroomPublishingSchema.parse(await request.json())
  const {
    title,
    classCode,
    termLabel,
    allowEnrollment,
    archived,
    lessonPlanVisibility,
    actualSiteSlug,
    actualSitePublished,
    actualSiteConfig,
    courseOverviewMarkdown,
    courseOutlineMarkdown,
  } = body

  if (
    title === undefined &&
    classCode === undefined &&
    termLabel === undefined &&
    allowEnrollment === undefined &&
    archived === undefined &&
    lessonPlanVisibility === undefined &&
    actualSiteSlug === undefined &&
    actualSitePublished === undefined &&
    actualSiteConfig === undefined &&
    courseOverviewMarkdown === undefined &&
    courseOutlineMarkdown === undefined
  ) {
    return NextResponse.json(
      { error: 'No fields to update' },
      { status: 400 }
    )
  }

  const supabase = getServiceRoleClient()

  const ownership = await assertTeacherOwnsClassroom(user.id, classroomId)
  if (!ownership.ok) {
    return NextResponse.json(
      { error: ownership.error },
      { status: ownership.status }
    )
  }

  const isArchived = !!ownership.classroom.archived_at
  const hasArchiveToggle = archived !== undefined
  const hasOtherUpdates =
    title !== undefined ||
    classCode !== undefined ||
    termLabel !== undefined ||
    allowEnrollment !== undefined ||
    lessonPlanVisibility !== undefined ||
    actualSiteSlug !== undefined ||
    actualSitePublished !== undefined ||
    actualSiteConfig !== undefined ||
    courseOverviewMarkdown !== undefined ||
    courseOutlineMarkdown !== undefined

  if (hasArchiveToggle && hasOtherUpdates) {
    return NextResponse.json(
      { error: 'Unarchive before updating classroom details' },
      { status: 400 }
    )
  }

  if (isArchived && hasOtherUpdates) {
    return NextResponse.json(
      { error: 'Classroom is archived' },
      { status: 403 }
    )
  }

  const updates: any = {}
  if (title !== undefined) updates.title = title
  if (classCode !== undefined) updates.class_code = classCode
  if (termLabel !== undefined) updates.term_label = termLabel
  if (allowEnrollment !== undefined) updates.allow_enrollment = !!allowEnrollment
  if (lessonPlanVisibility !== undefined) updates.lesson_plan_visibility = lessonPlanVisibility
  if (actualSiteSlug !== undefined) updates.actual_site_slug = actualSiteSlug
  if (actualSitePublished !== undefined) updates.actual_site_published = actualSitePublished
  if (actualSiteConfig !== undefined) updates.actual_site_config = normalizeActualCourseSiteConfig(actualSiteConfig)
  if (courseOverviewMarkdown !== undefined) updates.course_overview_markdown = courseOverviewMarkdown
  if (courseOutlineMarkdown !== undefined) updates.course_outline_markdown = courseOutlineMarkdown
  if (hasArchiveToggle) {
    if (archived && isArchived) {
      return NextResponse.json(
        { error: 'Classroom is already archived' },
        { status: 400 }
      )
    }
    if (!archived && !isArchived) {
      return NextResponse.json(
        { error: 'Classroom is not archived' },
        { status: 400 }
      )
    }
    if (!archived) {
      const nextPosition = await getNextTeacherClassroomPosition(supabase, user.id)
      if (nextPosition !== null) {
        updates.position = nextPosition
      }
    }
    updates.archived_at = archived ? new Date().toISOString() : null
  }

  if (actualSiteSlug !== undefined && actualSiteSlug) {
    const { data: slugConflict, error: slugError } = await supabase
      .from('classrooms')
      .select('id')
      .eq('actual_site_slug', actualSiteSlug)
      .neq('id', classroomId)
      .limit(1)

    if (slugError) {
      console.error('Error checking classroom site slug:', slugError)
      return NextResponse.json(
        { error: 'Failed to validate site slug' },
        { status: 500 }
      )
    }

    if ((slugConflict || []).length > 0) {
      return NextResponse.json(
        { error: 'That actual site slug is already in use' },
        { status: 409 }
      )
    }
  }

  const { data: updatedClassroom, error: updateError } = await supabase
    .from('classrooms')
    .update(updates)
    .eq('id', classroomId)
    .select()
    .single()

  if (updateError) {
    console.error('Error updating classroom:', updateError)
    return NextResponse.json(
      { error: 'Failed to update classroom' },
      { status: 500 }
    )
  }

  return NextResponse.json({ classroom: hydrateClassroomRecord(updatedClassroom as Record<string, any>) })
})

// DELETE /api/teacher/classrooms/[id] - Delete classroom
export const DELETE = withErrorHandler('DeleteClassroom', async (_request, context) => {
  const user = await requireRole('teacher')
  const { id: classroomId } = await context.params

  const supabase = getServiceRoleClient()

  const ownership = await assertTeacherOwnsClassroom(user.id, classroomId)
  if (!ownership.ok) {
    return NextResponse.json(
      { error: ownership.error },
      { status: ownership.status }
    )
  }

  if (!ownership.classroom.archived_at) {
    return NextResponse.json(
      { error: 'Classroom must be archived before deletion' },
      { status: 400 }
    )
  }

  const { error: deleteError } = await supabase
    .from('classrooms')
    .delete()
    .eq('id', classroomId)

  if (deleteError) {
    console.error('Error deleting classroom:', deleteError)
    return NextResponse.json(
      { error: 'Failed to delete classroom' },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true })
})
