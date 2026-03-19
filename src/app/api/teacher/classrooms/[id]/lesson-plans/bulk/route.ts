import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import { withErrorHandler } from '@/lib/api-handler'
import type { TiptapContent } from '@/types'
import { buildLessonPlanContentFields, getLessonPlanMarkdown } from '@/lib/lesson-plan-content'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface BulkPlanEntry {
  date: string // YYYY-MM-DD
  content_markdown?: string
  content?: TiptapContent
}

// PUT /api/teacher/classrooms/[id]/lesson-plans/bulk - Bulk upsert lesson plans
export const PUT = withErrorHandler('PutBulkUpsertLessonPlans', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: classroomId } = await context.params
  const body = await request.json()
  const { plans = [], cleared_dates = [] } = body as {
    plans?: BulkPlanEntry[]
    cleared_dates?: string[]
  }

  if (!Array.isArray(plans) || !Array.isArray(cleared_dates) || (plans.length === 0 && cleared_dates.length === 0)) {
    return NextResponse.json(
      { error: 'plans or cleared_dates is required and must not be empty' },
      { status: 400 }
    )
  }

  const MAX_PLANS = 250
  if (plans.length > MAX_PLANS || cleared_dates.length > MAX_PLANS) {
    return NextResponse.json(
      { error: `Too many plans. Maximum is ${MAX_PLANS} per request.` },
      { status: 400 }
    )
  }

  const ownership = await assertTeacherCanMutateClassroom(user.id, classroomId)
  if (!ownership.ok) {
    return NextResponse.json(
      { error: ownership.error },
      { status: ownership.status }
    )
  }

  // Validate all plans before upserting
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/
  const errors: string[] = []
  const seenDates = new Set<string>()

  for (const plan of plans) {
    if (!dateRegex.test(plan.date)) {
      errors.push(`Invalid date format: ${plan.date}`)
      continue
    }
    if (seenDates.has(plan.date)) {
      errors.push(`Duplicate date: ${plan.date}`)
      continue
    }
    seenDates.add(plan.date)

    const hasMarkdown = typeof plan.content_markdown === 'string'
    const hasContent = !!plan.content && plan.content.type === 'doc'
    if (!hasMarkdown && !hasContent) {
      errors.push(`Invalid content for date ${plan.date}`)
    }
  }

  for (const date of cleared_dates) {
    if (!dateRegex.test(date)) {
      errors.push(`Invalid date format: ${date}`)
      continue
    }
    if (seenDates.has(date)) {
      errors.push(`Duplicate date: ${date}`)
      continue
    }
    seenDates.add(date)
  }

  if (errors.length > 0) {
    return NextResponse.json({ errors }, { status: 400 })
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
