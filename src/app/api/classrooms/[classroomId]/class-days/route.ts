import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireRole } from '@/lib/auth'
import type { Semester } from '@/types'
import { getTodayInToronto } from '@/lib/timezone'
import {
  fetchClassDaysForClassroom,
  generateClassDaysForClassroom,
  upsertClassDayForClassroom,
} from '@/lib/server/class-days'
import {
  assertStudentCanAccessClassroom,
  assertTeacherCanMutateClassroom,
  assertTeacherOwnsClassroom,
} from '@/lib/server/classrooms'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/classrooms/:classroomId/class-days (auth required; teacher or student)
export const GET = withErrorHandler('GetClassDays', async (_request, context) => {
  const user = await requireAuth()

  const { classroomId } = await context.params
  if (!classroomId) {
    return NextResponse.json({ error: 'classroomId is required' }, { status: 400 })
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
    return NextResponse.json({ error: 'Failed to fetch class days' }, { status: 500 })
  }

  return NextResponse.json({ class_days: classDays })
})

// POST /api/classrooms/:classroomId/class-days (teacher only) — generate initial calendar
export const POST = withErrorHandler('PostClassDays', async (request, context) => {
  const user = await requireRole('teacher')
  const { classroomId } = await context.params
  if (!classroomId) {
    return NextResponse.json({ error: 'classroomId is required' }, { status: 400 })
  }

  const body = await request.json()
  const ownership = await assertTeacherCanMutateClassroom(user.id, classroomId)
  if (!ownership.ok) return NextResponse.json({ error: ownership.error }, { status: ownership.status })

  const result = await generateClassDaysForClassroom({
    classroomId,
    semester: body.semester as Semester | undefined,
    year: body.year,
    startDate: body.start_date,
    endDate: body.end_date,
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json({ success: true, count: result.count, class_days: result.classDays })
})

// PATCH /api/classrooms/:classroomId/class-days (teacher only) — toggle a single date
export const PATCH = withErrorHandler('PatchClassDay', async (request, context) => {
  const user = await requireRole('teacher')
  const { classroomId } = await context.params
  if (!classroomId) {
    return NextResponse.json({ error: 'classroomId is required' }, { status: 400 })
  }

  const body = await request.json()
  const { date, is_class_day } = body

  if (!date || typeof is_class_day !== 'boolean') {
    return NextResponse.json({ error: 'date and is_class_day are required' }, { status: 400 })
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/
  if (!dateRegex.test(date)) {
    return NextResponse.json({ error: 'Invalid date format (use YYYY-MM-DD)' }, { status: 400 })
  }

  const todayToronto = getTodayInToronto()
  if (date < todayToronto) {
    return NextResponse.json({ error: 'Cannot modify past class days' }, { status: 400 })
  }

  const ownership = await assertTeacherCanMutateClassroom(user.id, classroomId)
  if (!ownership.ok) return NextResponse.json({ error: ownership.error }, { status: ownership.status })

  const result = await upsertClassDayForClassroom({ classroomId, date, isClassDay: is_class_day })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json({ class_day: result.classDay })
})
