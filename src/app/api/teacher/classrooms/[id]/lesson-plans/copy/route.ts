import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/classrooms/[id]/lesson-plans/copy - Copy a lesson plan from one date to another
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id: classroomId } = await params
    const body = await request.json()
    const { fromDate, toDate } = body as { fromDate: string; toDate: string }

    // Validate date formats
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/
    if (!dateRegex.test(fromDate) || !dateRegex.test(toDate)) {
      return NextResponse.json(
        { error: 'Invalid date format. Expected YYYY-MM-DD for both fromDate and toDate' },
        { status: 400 }
      )
    }

    if (fromDate === toDate) {
      return NextResponse.json(
        { error: 'fromDate and toDate must be different' },
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

    const supabase = getServiceRoleClient()

    // Get the source lesson plan
    const { data: sourcePlan, error: sourceError } = await supabase
      .from('lesson_plans')
      .select('content')
      .eq('classroom_id', classroomId)
      .eq('date', fromDate)
      .single()

    if (sourceError || !sourcePlan) {
      return NextResponse.json(
        { error: 'Source lesson plan not found' },
        { status: 404 }
      )
    }

    // Upsert to target date
    const { data: targetPlan, error: targetError } = await supabase
      .from('lesson_plans')
      .upsert(
        {
          classroom_id: classroomId,
          date: toDate,
          content: sourcePlan.content,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'classroom_id,date',
        }
      )
      .select()
      .single()

    if (targetError) {
      console.error('Error copying lesson plan:', targetError)
      return NextResponse.json(
        { error: 'Failed to copy lesson plan' },
        { status: 500 }
      )
    }

    return NextResponse.json({ lesson_plan: targetPlan }, { status: 201 })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Copy lesson plan error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
