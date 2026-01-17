import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import type { TiptapContent } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface BulkPlanEntry {
  date: string // YYYY-MM-DD
  content: TiptapContent
}

// PUT /api/teacher/classrooms/[id]/lesson-plans/bulk - Bulk upsert lesson plans
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id: classroomId } = await params
    const body = await request.json()
    const { plans } = body as { plans: BulkPlanEntry[] }

    if (!Array.isArray(plans) || plans.length === 0) {
      return NextResponse.json(
        { error: 'plans array is required and must not be empty' },
        { status: 400 }
      )
    }

    const MAX_PLANS = 250
    if (plans.length > MAX_PLANS) {
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

      if (!plan.content || plan.content.type !== 'doc') {
        errors.push(`Invalid content for date ${plan.date}`)
      }
    }

    if (errors.length > 0) {
      return NextResponse.json({ errors }, { status: 400 })
    }

    const supabase = getServiceRoleClient()
    const now = new Date().toISOString()

    // Prepare upsert data
    const upsertData = plans.map((plan) => ({
      classroom_id: classroomId,
      date: plan.date,
      content: plan.content,
      updated_at: now,
    }))

    // Bulk upsert
    const { data: results, error } = await supabase
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

    return NextResponse.json({
      updated: results?.length || 0,
      lesson_plans: results || [],
    })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Bulk upsert lesson plans error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
