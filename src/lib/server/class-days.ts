import { getServiceRoleClient } from '@/lib/supabase'
import { generateClassDays, generateClassDaysFromRange, getSemesterDates } from '@/lib/calendar'
import { getTodayInToronto } from '@/lib/timezone'
import { format, parse } from 'date-fns'
import type { Semester } from '@/types'

export async function fetchClassDaysForClassroom(classroomId: string) {
  const supabase = getServiceRoleClient()
  const { data: classDays, error } = await supabase
    .from('class_days')
    .select('*')
    .eq('classroom_id', classroomId)
    .order('date', { ascending: true })

  return { classDays: classDays || [], error }
}

export async function assertTeacherOwnsClassroom(teacherId: string, classroomId: string) {
  const supabase = getServiceRoleClient()
  const { data: classroom, error } = await supabase
    .from('classrooms')
    .select('teacher_id')
    .eq('id', classroomId)
    .single()

  if (error || !classroom) {
    return { ok: false as const, status: 404 as const, error: 'Classroom not found' }
  }

  if (classroom.teacher_id !== teacherId) {
    return { ok: false as const, status: 403 as const, error: 'Forbidden' }
  }

  return { ok: true as const }
}

export async function generateClassDaysForClassroom(args: {
  classroomId: string
  semester?: Semester
  year?: number
  startDate?: string
  endDate?: string
}) {
  const { classroomId, semester, year, startDate, endDate } = args

  const supabase = getServiceRoleClient()

  const { data: existing } = await supabase
    .from('class_days')
    .select('id')
    .eq('classroom_id', classroomId)
    .limit(1)

  if (existing && existing.length > 0) {
    return { ok: false as const, status: 409 as const, error: 'Class days already exist for this classroom. Use PATCH to update.' }
  }

  const hasSemesterParams = Boolean(semester && year)
  const hasCustomParams = Boolean(startDate && endDate)
  if (!hasSemesterParams && !hasCustomParams) {
    return {
      ok: false as const,
      status: 400 as const,
      error: 'Either (semester + year) or (start_date + end_date) are required',
    }
  }

  let dates: string[]
  let rangeStart: Date
  let rangeEnd: Date

  if (hasSemesterParams) {
    dates = generateClassDays(semester as Semester, year as number)
    const semesterDates = getSemesterDates(semester as Semester, year as number)
    rangeStart = semesterDates.start
    rangeEnd = semesterDates.end
  } else {
    const parsedStart = parse(startDate as string, 'yyyy-MM-dd', new Date())
    const parsedEnd = parse(endDate as string, 'yyyy-MM-dd', new Date())

    if (parsedStart >= parsedEnd) {
      return { ok: false as const, status: 400 as const, error: 'end_date must be after start_date' }
    }

    dates = generateClassDaysFromRange(parsedStart, parsedEnd)
    rangeStart = parsedStart
    rangeEnd = parsedEnd
  }

  const { error: rangeError } = await supabase
    .from('classrooms')
    .update({
      start_date: format(rangeStart, 'yyyy-MM-dd'),
      end_date: format(rangeEnd, 'yyyy-MM-dd'),
    })
    .eq('id', classroomId)

  if (rangeError) {
    return { ok: false as const, status: 500 as const, error: 'Failed to update classroom calendar range' }
  }

  const classDayRecords = dates.map(date => ({
    classroom_id: classroomId,
    date,
    is_class_day: true,
    prompt_text: null,
  }))

  const { data: created, error } = await supabase
    .from('class_days')
    .insert(classDayRecords)
    .select()

  if (error) {
    return { ok: false as const, status: 500 as const, error: 'Failed to create class days' }
  }

  return { ok: true as const, count: created.length, classDays: created }
}

export async function upsertClassDayForClassroom(args: {
  classroomId: string
  date: string
  isClassDay: boolean
}) {
  const { classroomId, date, isClassDay } = args
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/
  if (!dateRegex.test(date)) {
    return { ok: false as const, status: 400 as const, error: 'Invalid date format (use YYYY-MM-DD)' }
  }

  const todayToronto = getTodayInToronto()
  if (date < todayToronto) {
    return { ok: false as const, status: 400 as const, error: 'Cannot modify past class days' }
  }

  const supabase = getServiceRoleClient()

  const { data: existing } = await supabase
    .from('class_days')
    .select('id')
    .eq('classroom_id', classroomId)
    .eq('date', date)
    .single()

  if (!existing) {
    const { data: created, error: createError } = await supabase
      .from('class_days')
      .insert({
        classroom_id: classroomId,
        date,
        is_class_day: isClassDay,
        prompt_text: null,
      })
      .select()
      .single()

    if (createError) {
      return { ok: false as const, status: 500 as const, error: 'Failed to create class day' }
    }

    return { ok: true as const, classDay: created }
  }

  const { data: updated, error } = await supabase
    .from('class_days')
    .update({ is_class_day: isClassDay })
    .eq('id', existing.id)
    .select()
    .single()

  if (error) {
    return { ok: false as const, status: 500 as const, error: 'Failed to update class day' }
  }

  return { ok: true as const, classDay: updated }
}

