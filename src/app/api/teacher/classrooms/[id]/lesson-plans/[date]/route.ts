import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import { withErrorHandler } from '@/lib/api-handler'
import {
  authorizeContextualLessonPlanMutationActor,
  preflightContextualLessonPlanMutation,
  saveContextualLessonPlan,
} from '@/lib/server/contextual-lesson-plan-mutation'
import type { TableRow } from '@/types/database'
import type { Json } from '@/types/database.generated'
import {
  buildLessonPlanContentFields,
  getLessonPlanMarkdown,
  normalizeLessonPlanMarkdown,
} from '@/lib/lesson-plan-content'
import {
  lessonPlanDateSchema,
  lessonPlanMutationBodySchema,
} from '@/lib/validations/lesson-plan-mutations'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// PUT /api/teacher/classrooms/[id]/lesson-plans/[date] - Upsert lesson plan for a date
export const PUT = withErrorHandler('PutUpsertLessonPlan', async (request, context) => {
  const actor = await authorizeContextualLessonPlanMutationActor()
  if (actor.mode === 'contextual') {
    const scope = await preflightContextualLessonPlanMutation({
      actorId: actor.user.id,
      params: await context.params,
    })
    const { content_markdown, content, mutation } = lessonPlanMutationBodySchema.parse(await request.json())
    const markdown = typeof content_markdown === 'string'
      ? content_markdown
      : content && content.type === 'doc'
        ? getLessonPlanMarkdown({ content_markdown: null, content }).markdown
        : null
    if (markdown === null) {
      return NextResponse.json({ error: 'Invalid content format' }, { status: 400 })
    }
    const fields = buildLessonPlanContentFields(markdown)
    const shouldDelete = normalizeLessonPlanMarkdown(markdown).trim().length === 0
    const result = await saveContextualLessonPlan({
      actorId: scope.actorId,
      classroomId: scope.classroomId,
      date: scope.date,
      markdown: fields.content_markdown,
      content: fields.content,
      shouldDelete,
      mutation,
    })
    if (mutation) return NextResponse.json(result)
    if (shouldDelete) return NextResponse.json({ lesson_plan: null, date: scope.date })
    return NextResponse.json({ lesson_plan: result.lesson_plan })
  }

  const user = actor.user
  const { id: classroomId, date } = await context.params
  const { content_markdown, content, mutation: mutationVersion } = lessonPlanMutationBodySchema.parse(
    await request.json(),
  )

  // Validate date format (YYYY-MM-DD)
  if (!lessonPlanDateSchema.safeParse(date).success) {
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
    return NextResponse.json({ error: 'Invalid content format' }, { status: 400 })
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

  if (mutationVersion) {
    const shouldDelete = normalizeLessonPlanMarkdown(markdown).trim().length === 0
    const { data, error } = await supabase.rpc('apply_ordered_lesson_plan_mutation', {
      p_classroom_id: classroomId,
      p_client_id: mutationVersion.client_id,
      p_content: contentFields.content as unknown as Json,
      p_content_markdown: contentFields.content_markdown,
      p_date: date,
      p_delete: shouldDelete,
      p_sequence: mutationVersion.sequence,
    })

    if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
      console.error('Error applying ordered lesson plan mutation:', error)
      return NextResponse.json({ error: 'Failed to save lesson plan' }, { status: 500 })
    }

    const result = data as { applied?: boolean; lesson_plan?: TableRow<'lesson_plans'> | null }
    const lessonPlan = result.lesson_plan
    return NextResponse.json({
      applied: result.applied === true,
      lesson_plan: lessonPlan
        ? {
            ...lessonPlan,
            content_markdown: getLessonPlanMarkdown(lessonPlan).markdown,
          }
        : null,
    })
  }

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
