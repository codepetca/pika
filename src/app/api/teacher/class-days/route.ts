import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import type { Semester } from '@/types'
import {
  fetchClassDaysForClassroom,
  generateClassDaysForClassroom,
  upsertClassDayForClassroom,
} from '@/lib/server/class-days'
import { getTodayInToronto } from '@/lib/timezone'
import {
  assertStudentCanAccessClassroom,
  assertTeacherCanMutateClassroom,
  assertTeacherOwnsClassroom,
} from '@/lib/server/classrooms'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/teacher/class-days?classroom_id=xxx
 * Fetches class days for a classroom.
 * Accessible by both teachers and students.
 *
 * Legacy route: prefer GET /api/classrooms/:classroomId/class-days
 */
export const GET = withErrorHandler('GetTeacherClassDays', async (request, context) => {
  // Allow both teachers and students to read class days
  const user = await requireAuth()

  const { searchParams } = new URL(request.url)
  const classroomId = searchParams.get('classroom_id')

  if (!classroomId) {
    return NextResponse.json(
      { error: 'classroom_id is required' },
      { status: 400 }
    )
  }

  if (user.role === 'teacher') {
    const ownership = await assertTeacherOwnsClassroom(user.id, classroomId)
    if (!ownership.ok) return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  } else if (user.role === 'student') {
    const access = await assertStudentCanAccessClassroom(user.id, classroomId)
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  } else {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { classDays, error } = await fetchClassDaysForClassroom(classroomId)
  if (error) {
    console.error('Error fetching class days:', error)
    return NextResponse.json(
      { error: 'Failed to fetch class days' },
      { status: 500 }
    )
  }

  return NextResponse.json({ class_days: classDays })
})

/**
 * POST /api/teacher/class-days
 * Generates class days for a classroom
 * Accepts either:
 * - { classroom_id, semester, year } for preset semesters
 * - { classroom_id, start_date, end_date } for custom date ranges
 *
 * Legacy route: prefer POST /api/classrooms/:classroomId/class-days
 */
export const POST = withErrorHandler('PostTeacherClassDays', async (request, context) => {
  const user = await requireRole('teacher')

  const body = await request.json()
  const { classroom_id, semester, year, start_date, end_date } = body

  // Validate input - either semester/year OR start_date/end_date
  const hasSemesterParams = semester && year
  const hasCustomParams = start_date && end_date

  if (!classroom_id || (!hasSemesterParams && !hasCustomParams)) {
    return NextResponse.json(
      { error: 'classroom_id and either (semester + year) or (start_date + end_date) are required' },
      { status: 400 }
    )
  }

  const ownership = await assertTeacherCanMutateClassroom(user.id, classroom_id)
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  }

  const result = await generateClassDaysForClassroom({
    classroomId: classroom_id,
    semester: semester as Semester | undefined,
    year,
    startDate: start_date,
    endDate: end_date,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({
    success: true,
    count: result.count,
    class_days: result.classDays,
  })
})

/**
 * PATCH /api/teacher/class-days
 * Toggles is_class_day for a specific date
 *
 * Legacy route: prefer PATCH /api/classrooms/:classroomId/class-days
 */
export const PATCH = withErrorHandler('PatchTeacherClassDays', async (request, context) => {
  const user = await requireRole('teacher')

  const body = await request.json()
  const { classroom_id, date, is_class_day } = body

  if (!classroom_id || !date || typeof is_class_day !== 'boolean') {
    return NextResponse.json(
      { error: 'classroom_id, date, and is_class_day are required' },
      { status: 400 }
    )
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/
  if (!dateRegex.test(date)) {
    return NextResponse.json(
      { error: 'Invalid date format (use YYYY-MM-DD)' },
      { status: 400 }
    )
  }

  const todayToronto = getTodayInToronto()
  if (date < todayToronto) {
    return NextResponse.json(
      { error: 'Cannot modify past class days' },
      { status: 400 }
    )
  }

  const ownership = await assertTeacherCanMutateClassroom(user.id, classroom_id)
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  }

  const result = await upsertClassDayForClassroom({ classroomId: classroom_id, date, isClassDay: is_class_day })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({ class_day: result.classDay })
})
