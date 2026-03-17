import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertTeacherOwnsClassroom } from '@/lib/server/classrooms'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/teacher/classrooms/[id]/lesson-plans?start=YYYY-MM-DD&end=YYYY-MM-DD
export const GET = withErrorHandler('GetLessonPlans', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: classroomId } = await context.params
  const { searchParams } = new URL(request.url)
  const start = searchParams.get('start')
  const end = searchParams.get('end')

  if (!start || !end) {
    return NextResponse.json(
      { error: 'start and end query params are required (YYYY-MM-DD)' },
      { status: 400 }
    )
  }

  const ownership = await assertTeacherOwnsClassroom(user.id, classroomId)
  if (!ownership.ok) {
    return NextResponse.json(
      { error: ownership.error },
      { status: ownership.status }
    )
  }

  const supabase = getServiceRoleClient()

  const { data: lessonPlans, error } = await supabase
    .from('lesson_plans')
    .select('*')
    .eq('classroom_id', classroomId)
    .gte('date', start)
    .lte('date', end)
    .order('date', { ascending: true })

  if (error) {
    console.error('Error fetching lesson plans:', error)
    return NextResponse.json(
      { error: 'Failed to fetch lesson plans' },
      { status: 500 }
    )
  }

  return NextResponse.json({ lesson_plans: lessonPlans || [] })
})
