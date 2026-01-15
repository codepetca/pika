import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import type { TiptapContent } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// PUT /api/teacher/classrooms/[id]/lesson-plans/[date] - Upsert lesson plan for a date
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; date: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id: classroomId, date } = await params
    const body = await request.json()
    const { content } = body as { content: TiptapContent }

    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: 'Invalid date format. Expected YYYY-MM-DD' },
        { status: 400 }
      )
    }

    if (!content || content.type !== 'doc') {
      return NextResponse.json(
        { error: 'Invalid content format' },
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

    // Upsert: insert or update based on (classroom_id, date) unique constraint
    const { data: lessonPlan, error } = await supabase
      .from('lesson_plans')
      .upsert(
        {
          classroom_id: classroomId,
          date,
          content,
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

    return NextResponse.json({ lesson_plan: lessonPlan })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Upsert lesson plan error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
