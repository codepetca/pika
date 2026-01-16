import { NextRequest, NextResponse } from 'next/server'
import { format } from 'date-fns'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'
import { nowInToronto } from '@/lib/timezone'
import type { LessonPlanVisibility } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Get the maximum allowed date for student visibility.
 * - current_week: end of current week (Saturday)
 * - one_week_ahead: end of next week (Saturday)
 * - all: no limit (returns null)
 */
function getMaxAllowedDate(visibility: LessonPlanVisibility): string | null {
  if (visibility === 'all') {
    return null
  }

  // Use Toronto timezone for consistency with the rest of the app
  const now = nowInToronto()
  const dayOfWeek = now.getDay() // 0 = Sunday, 6 = Saturday

  // Find end of current week (Saturday)
  // If today is Saturday (6), add 7 days to get next Saturday
  const daysUntilSaturday = (6 - dayOfWeek + 7) % 7 || 7
  const endOfCurrentWeek = new Date(now)
  endOfCurrentWeek.setDate(now.getDate() + daysUntilSaturday)

  if (visibility === 'current_week') {
    return format(endOfCurrentWeek, 'yyyy-MM-dd')
  }

  // one_week_ahead: add 7 more days
  const endOfNextWeek = new Date(endOfCurrentWeek)
  endOfNextWeek.setDate(endOfCurrentWeek.getDate() + 7)
  return format(endOfNextWeek, 'yyyy-MM-dd')
}

// GET /api/student/classrooms/[id]/lesson-plans?start=YYYY-MM-DD&end=YYYY-MM-DD
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('student')
    const { id: classroomId } = await params
    const { searchParams } = new URL(request.url)
    const start = searchParams.get('start')
    const end = searchParams.get('end')

    if (!start || !end) {
      return NextResponse.json(
        { error: 'start and end query params are required (YYYY-MM-DD)' },
        { status: 400 }
      )
    }

    const access = await assertStudentCanAccessClassroom(user.id, classroomId)
    if (!access.ok) {
      return NextResponse.json(
        { error: access.error },
        { status: access.status }
      )
    }

    const supabase = getServiceRoleClient()

    // Get classroom visibility setting
    const { data: classroom, error: classroomError } = await supabase
      .from('classrooms')
      .select('lesson_plan_visibility')
      .eq('id', classroomId)
      .single()

    if (classroomError || !classroom) {
      return NextResponse.json(
        { error: 'Classroom not found' },
        { status: 404 }
      )
    }

    const visibility = (classroom.lesson_plan_visibility || 'current_week') as LessonPlanVisibility
    const maxDate = getMaxAllowedDate(visibility)

    // Clamp end date to max allowed if visibility restricts it
    let effectiveEnd = end
    if (maxDate && end > maxDate) {
      effectiveEnd = maxDate
    }

    // Don't return anything if start is beyond max allowed date
    if (maxDate && start > maxDate) {
      return NextResponse.json({ lesson_plans: [], visibility, max_date: maxDate })
    }

    const { data: lessonPlans, error } = await supabase
      .from('lesson_plans')
      .select('*')
      .eq('classroom_id', classroomId)
      .gte('date', start)
      .lte('date', effectiveEnd)
      .order('date', { ascending: true })

    if (error) {
      console.error('Error fetching lesson plans:', error)
      return NextResponse.json(
        { error: 'Failed to fetch lesson plans' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      lesson_plans: lessonPlans || [],
      visibility,
      max_date: maxDate,
    })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Get lesson plans error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
