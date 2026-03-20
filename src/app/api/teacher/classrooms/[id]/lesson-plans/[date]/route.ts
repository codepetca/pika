import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import { withErrorHandler } from '@/lib/api-handler'
import type { TiptapContent } from '@/types'
import {
  buildLessonPlanContentFields,
  getLessonPlanMarkdown,
  normalizeLessonPlanMarkdown,
} from '@/lib/lesson-plan-content'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// PUT /api/teacher/classrooms/[id]/lesson-plans/[date] - Upsert lesson plan for a date
export const PUT = withErrorHandler('PutUpsertLessonPlan', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: classroomId, date } = await context.params
  const body = await request.json()
  const { content_markdown, content } = body as { content_markdown?: string; content?: TiptapContent }

  // Validate date format (YYYY-MM-DD)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: 'Invalid date format. Expected YYYY-MM-DD' },
      { status: 400 }
    )
  }

  const markdown =
    typeof content_markdown === 'string'
      ? content_markdown
      : content && content.type === 'doc'
        ? getLessonPlanMarkdown({ content_markdown: null, content }).markdown
        : null

  if (markdown === null) {
    return NextResponse.json(
      { error: 'Invalid content format' },
      { status: 400 }
    )
  }

  const contentFields = buildLessonPlanContentFields(markdown)

  const ownership = await assertTeacherCanMutateClassroom(user.id, classroomId)
  if (!ownership.ok) {
    return NextResponse.json(
      { error: ownership.error },
      { status: ownership.status }
    )
  }

  const supabase = getServiceRoleClient()

  if (normalizeLessonPlanMarkdown(markdown).trim().length === 0) {
    const { error } = await supabase
      .from('lesson_plans')
      .delete()
      .eq('classroom_id', classroomId)
      .eq('date', date)

    if (error) {
      console.error('Error clearing lesson plan:', error)
      return NextResponse.json(
        { error: 'Failed to save lesson plan' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      lesson_plan: null,
      date,
    })
  }

  // Upsert: insert or update based on (classroom_id, date) unique constraint
  const { data: lessonPlan, error } = await supabase
    .from('lesson_plans')
    .upsert(
      {
        classroom_id: classroomId,
        date,
        content_markdown: contentFields.content_markdown,
        content: contentFields.content,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'classroom_id,date',
      }
    )
    .select()
    .single()

  if (error) {
    console.error('Error upserting lesson plan:', error)
    return NextResponse.json(
      { error: 'Failed to save lesson plan' },
      { status: 500 }
    )
  }

  return NextResponse.json({
    lesson_plan: {
      ...lessonPlan,
      content_markdown: getLessonPlanMarkdown(lessonPlan).markdown,
    },
  })
})

export const POST = PUT
