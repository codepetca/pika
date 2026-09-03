import { ApiError } from '@/lib/api-error'
import { canAccessClassroom, type ClassroomAccessContext } from '@/lib/access/classroom-policy'
import { generateClassDaysFromRange } from '@/lib/calendar'
import { getServiceRoleClient } from '@/lib/supabase'
import { getTodayInToronto } from '@/lib/timezone'
import { classroomCalendarRowsSchema, type CreateClassroomCalendarInput, type SetClassroomCalendarDayInput } from '@/lib/validations/classroom-calendar'

function assertOwner(context: ClassroomAccessContext): void {
  if (!canAccessClassroom(context, 'manage')) throw new ApiError(403, 'Forbidden')
}

function rpcError(code: string, creating: boolean): never {
  if (code === 'P0002') throw new ApiError(404, 'Classroom not found')
  if (code === '42501') throw new ApiError(403, 'Forbidden')
  if (code === '22023') throw new ApiError(400, creating ? 'Invalid classroom calendar' : 'Cannot modify past class days')
  if (creating && code === '23505') throw new ApiError(409, 'Class days already exist for this classroom. Use PATCH to update.')
  // Missing RPC/schema, transport errors and unexpected constraints never fall
  // back to the non-atomic legacy writers or expose database error details.
  throw new ApiError(503, 'Unable to update classroom calendar')
}

function verifyRows(data: unknown, context: ClassroomAccessContext, dates: string[], value: boolean) {
  const parsed = classroomCalendarRowsSchema.safeParse(data)
  if (!parsed.success) throw new ApiError(503, 'Unable to verify classroom calendar')
  const expected = new Set(dates)
  const rows = parsed.data
  if (rows.length !== expected.size || new Set(rows.map((row) => row.id)).size !== rows.length
    || new Set(rows.map((row) => row.date)).size !== rows.length
    || rows.some((row) => row.classroom_id !== context.classroomId || !expected.has(row.date) || row.is_class_day !== value)) {
    throw new ApiError(503, 'Unable to verify classroom calendar')
  }
  return rows
}

/** Context must come from the authenticated classroom-core gate, never HTTP JSON. */
export async function createContextualClassroomCalendar(context: ClassroomAccessContext, input: CreateClassroomCalendarInput) {
  assertOwner(context)
  const dates = generateClassDaysFromRange(new Date(`${input.start_date}T12:00:00Z`), new Date(`${input.end_date}T12:00:00Z`))
  if (!dates.length) throw new ApiError(400, 'Calendar range contains no class days')
  const { data, error } = await getServiceRoleClient().rpc('create_classroom_calendar_v1', {
    p_actor_id: context.userId, p_classroom_id: context.classroomId,
    p_start_date: input.start_date, p_end_date: input.end_date, p_dates: dates,
  })
  if (error) rpcError(error.code, true)
  const classDays = verifyRows(data, context, dates, true)
  return { success: true, count: classDays.length, class_days: classDays }
}

export async function setContextualClassroomCalendarDay(context: ClassroomAccessContext, input: SetClassroomCalendarDayInput) {
  assertOwner(context)
  if (input.date < getTodayInToronto()) throw new ApiError(400, 'Cannot modify past class days')
  const { data, error } = await getServiceRoleClient().rpc('set_classroom_calendar_day_v1', {
    p_actor_id: context.userId, p_classroom_id: context.classroomId,
    p_date: input.date, p_is_class_day: input.is_class_day,
  })
  if (error) rpcError(error.code, false)
  return { class_day: verifyRows(data, context, [input.date], input.is_class_day)[0] }
}
