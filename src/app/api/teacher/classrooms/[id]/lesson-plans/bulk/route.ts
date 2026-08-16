import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import { withErrorHandler } from '@/lib/api-handler'
import type { TableRow } from '@/types/database'
import type { Json } from '@/types/database.generated'
import { buildLessonPlanContentFields, getLessonPlanMarkdown } from '@/lib/lesson-plan-content'
import { bulkLessonPlanMutationBodySchema } from '@/lib/validations/lesson-plan-mutations'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// PUT /api/teacher/classrooms/[id]/lesson-plans/bulk - Bulk upsert lesson plans
export const PUT = withErrorHandler('PutBulkUpsertLessonPlans', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: classroomId } = await context.params
  const {
    plans,
    cleared_dates,
    mutation: mutationVersion,
  } = bulkLessonPlanMutationBodySchema.parse(await request.json())

  const ownership = await assertTeacherCanMutateClassroom(user.id, classroomId)
  if (!ownership.ok) {
    return NextResponse.json(
      { error: ownership.error },
      { status: ownership.status }
    )
  }

  const supabase = getServiceRoleClient()
  const now = new Date().toISOString()

  // Prepare upsert data
  const upsertData = plans.map((plan) => {
    const markdown =
      typeof plan.content_markdown === 'string'
        ? plan.content_markdown
        : getLessonPlanMarkdown({ content_markdown: null, content: plan.content ?? null }).markdown
    const contentFields = buildLessonPlanContentFields(markdown)
    return {
      classroom_id: classroomId,
      date: plan.date,
      content_markdown: contentFields.content_markdown,
      content: contentFields.content,
      updated_at: now,
    }
  })

  if (mutationVersion) {
    const lessonPlans: TableRow<'lesson_plans'>[] = []
    let updated = 0
    let cleared = 0

    for (const plan of upsertData) {
      const { data, error } = await supabase.rpc('apply_ordered_lesson_plan_mutation', {
        p_classroom_id: classroomId,
        p_client_id: mutationVersion.client_id,
        p_content: plan.content as unknown as Json,
        p_content_markdown: plan.content_markdown,
        p_date: plan.date,
        p_delete: false,
        p_sequence: mutationVersion.sequence,
      })
      if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
        console.error('Error applying ordered bulk lesson plan mutation:', error)
        return NextResponse.json({ error: 'Failed to save lesson plans' }, { status: 500 })
      }
      const result = data as { applied?: boolean; lesson_plan?: TableRow<'lesson_plans'> | null }
      if (result.applied) updated += 1
      if (result.lesson_plan) lessonPlans.push(result.lesson_plan)
    }

    for (const date of cleared_dates) {
      const { data, error } = await supabase.rpc('apply_ordered_lesson_plan_mutation', {
        p_classroom_id: classroomId,
        p_client_id: mutationVersion.client_id,
        p_content: {},
        p_content_markdown: '',
        p_date: date,
        p_delete: true,
        p_sequence: mutationVersion.sequence,
      })
      if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
        console.error('Error applying ordered bulk lesson plan clear:', error)
        return NextResponse.json({ error: 'Failed to save lesson plans' }, { status: 500 })
      }
      const result = data as { applied?: boolean }
      if (result.applied) cleared += 1
    }

    return NextResponse.json({
      updated,
      cleared,
      lesson_plans: lessonPlans.map((lessonPlan) => ({
        ...lessonPlan,
        content_markdown: getLessonPlanMarkdown(lessonPlan).markdown,
      })),
    })
  }

  let clearedCount = 0
  if (cleared_dates.length > 0) {
    const { error } = await supabase
      .from('lesson_plans')
      .delete()
      .eq('classroom_id', classroomId)
      .in('date', cleared_dates)

    if (error) {
      console.error('Error bulk clearing lesson plans:', error)
      return NextResponse.json(
        { error: 'Failed to save lesson plans' },
        { status: 500 }
      )
    }

    clearedCount = cleared_dates.length
  }

  let results: any[] | null = []
  if (upsertData.length > 0) {
    const { data, error } = await supabase
      .from('lesson_plans')
      .upsert(upsertData, {
        onConflict: 'classroom_id,date',
      })
      .select()

    if (error) {
      console.error('Error bulk upserting lesson plans:', error)
      return NextResponse.json(
        { error: 'Failed to save lesson plans' },
        { status: 500 }
      )
    }

    results = data
  }

  return NextResponse.json({
    updated: results?.length || 0,
    cleared: clearedCount,
    lesson_plans: (results || []).map((lessonPlan) => ({
      ...lessonPlan,
      content_markdown: getLessonPlanMarkdown(lessonPlan).markdown,
    })),
  })
})
