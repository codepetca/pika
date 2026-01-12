import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireRole } from '@/lib/auth'
import { getWeekStartForDate } from '@/lib/week-utils'
import {
  fetchDailyPlansForWeek,
  upsertDailyPlan,
  updatePlansVisibility,
} from '@/lib/server/daily-plans'
import {
  assertStudentCanAccessClassroom,
  assertTeacherCanMutateClassroom,
  assertTeacherOwnsClassroom,
} from '@/lib/server/classrooms'
import type { FuturePlansVisibility, TiptapContent } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/classrooms/:classroomId/daily-plans?week_start=YYYY-MM-DD
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ classroomId: string }> }
) {
  try {
    const user = await requireAuth()
    const { classroomId } = await context.params

    if (!classroomId) {
      return NextResponse.json({ error: 'classroomId is required' }, { status: 400 })
    }

    // Verify access
    if (user.role === 'teacher') {
      const ownership = await assertTeacherOwnsClassroom(user.id, classroomId)
      if (!ownership.ok) {
        return NextResponse.json({ error: ownership.error }, { status: ownership.status })
      }
    } else if (user.role === 'student') {
      const access = await assertStudentCanAccessClassroom(user.id, classroomId)
      if (!access.ok) {
        return NextResponse.json({ error: access.error }, { status: access.status })
      }
    } else {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get week_start from query params
    const { searchParams } = new URL(request.url)
    const weekStartParam = searchParams.get('week_start')

    if (!weekStartParam) {
      return NextResponse.json({ error: 'week_start query parameter is required' }, { status: 400 })
    }

    // Validate and normalize week_start to Monday
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/
    if (!dateRegex.test(weekStartParam)) {
      return NextResponse.json({ error: 'Invalid week_start format (use YYYY-MM-DD)' }, { status: 400 })
    }

    const weekStart = getWeekStartForDate(weekStartParam)

    const result = await fetchDailyPlansForWeek({
      classroomId,
      weekStart,
      role: user.role,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({
      plans: result.plans,
      week_start: weekStart,
      visibility: result.visibility,
    })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Get daily plans error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/classrooms/:classroomId/daily-plans
// Body: { date: string, rich_content: TiptapContent } OR { visibility: FuturePlansVisibility }
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ classroomId: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { classroomId } = await context.params

    if (!classroomId) {
      return NextResponse.json({ error: 'classroomId is required' }, { status: 400 })
    }

    const ownership = await assertTeacherCanMutateClassroom(user.id, classroomId)
    if (!ownership.ok) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status })
    }

    const body = await request.json()

    // Handle visibility update
    if ('visibility' in body) {
      const visibility = body.visibility as FuturePlansVisibility
      const result = await updatePlansVisibility({ classroomId, visibility })

      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status })
      }

      return NextResponse.json({ success: true, visibility })
    }

    // Handle plan upsert
    const { date, rich_content } = body

    if (!date) {
      return NextResponse.json({ error: 'date is required' }, { status: 400 })
    }

    if (!rich_content || typeof rich_content !== 'object') {
      return NextResponse.json({ error: 'rich_content is required and must be an object' }, { status: 400 })
    }

    const result = await upsertDailyPlan({
      classroomId,
      date,
      richContent: rich_content as TiptapContent,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ plan: result.plan })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Update daily plan error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
