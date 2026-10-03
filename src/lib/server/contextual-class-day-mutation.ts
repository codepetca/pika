import { ApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { generateClassDaysFromRange } from '@/lib/calendar'
import { getServiceRoleClient } from '@/lib/supabase'
import { getTodayInToronto } from '@/lib/timezone'
import { isClassroomExperienceAdmissionConfigured, resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'
import { contextualClassDayMutationEnvelopeSchema, contextualClassDayMutationIdentitySchema } from '@/lib/validations/contextual-class-day-mutation'
import type { CreateClassroomCalendarInput, SetClassroomCalendarDayInput } from '@/lib/validations/classroom-calendar'
import type { AuthenticatedUser } from '@/types'
import type { TableRow } from '@/types/database'

export type ContextualClassDayMutationClient = ReturnType<typeof getServiceRoleClient>
type Identity = { supabase: ContextualClassDayMutationClient; actorId: string; classroomId: string }
// Transport or validation failure can follow a committed RPC: refresh before retrying.
const unavailable = () => new ApiError(503, 'Unable to verify classroom calendar. Refresh before retrying.')

export async function authorizeSharedClassDayMutationActor(): Promise<{ mode: 'existing' } | { mode: 'shared'; user: AuthenticatedUser }> {
  if (!isClassroomExperienceAdmissionConfigured()) return { mode: 'existing' }
  const user = await requireAuth()
  if (resolveClassroomExperienceAdmission(user).status !== 'admitted') return { mode: 'existing' }
  return { mode: 'shared', user }
}

function identity(input: Identity) {
  const parsed = contextualClassDayMutationIdentitySchema.safeParse({ actorId: input.actorId, classroomId: input.classroomId })
  if (!parsed.success) throw new ApiError(400, 'Invalid calendar identity')
  return parsed.data
}
function rpcError(code: string, creating: boolean): never {
  if (code === 'P0002') throw new ApiError(404, 'Classroom not found')
  if (code === '42501') throw new ApiError(403, 'Forbidden')
  if (code === '22023') throw new ApiError(400, creating ? 'Invalid classroom calendar' : 'Cannot modify past class days')
  if (creating && code === '23505') throw new ApiError(409, 'Class days already exist for this classroom. Use PATCH to update.')
  throw unavailable()
}
async function invoke(operation: () => PromiseLike<unknown>): Promise<unknown> {
  try { return await operation() } catch { throw unavailable() }
}
function verifiedRows(response: unknown, classroomId: string, dates: string[], value: boolean, creating: boolean): TableRow<'class_days'>[] {
  const envelope = contextualClassDayMutationEnvelopeSchema.safeParse(response)
  if (!envelope.success) throw unavailable()
  if (envelope.data.error !== null) rpcError(envelope.data.error.code, creating)
  const rows = envelope.data.data
  const expected = new Set(dates)
  if (rows.length !== expected.size || new Set(rows.map(row => row.id)).size !== rows.length
    || new Set(rows.map(row => row.date)).size !== rows.length
    || rows.some(row => row.classroom_id !== classroomId || !expected.has(row.date) || row.is_class_day !== value)) throw unavailable()
  return rows
}

/** The installed RPC locks and checks the current active owner; no client relationship claim authorizes a write. */
export async function createContextualClassDayCalendar(input: Identity & { input: CreateClassroomCalendarInput }) {
  const { actorId, classroomId } = identity(input)
  const dates = generateClassDaysFromRange(new Date(`${input.input.start_date}T12:00:00Z`), new Date(`${input.input.end_date}T12:00:00Z`))
  if (!dates.length) throw new ApiError(400, 'Calendar range contains no class days')
  const response = await invoke(() => input.supabase.rpc('create_classroom_calendar_v1', {
    p_actor_id: actorId, p_classroom_id: classroomId,
    p_start_date: input.input.start_date, p_end_date: input.input.end_date, p_dates: dates,
  }))
  const classDays = verifiedRows(response, classroomId, dates, true, true)
  return { success: true as const, count: classDays.length, class_days: classDays }
}

export async function setContextualClassDay(input: Identity & { input: SetClassroomCalendarDayInput }) {
  const { actorId, classroomId } = identity(input)
  if (input.input.date < getTodayInToronto()) throw new ApiError(400, 'Cannot modify past class days')
  const response = await invoke(() => input.supabase.rpc('set_classroom_calendar_day_v1', {
    p_actor_id: actorId, p_classroom_id: classroomId,
    p_date: input.input.date, p_is_class_day: input.input.is_class_day,
  }))
  return { class_day: verifiedRows(response, classroomId, [input.input.date], input.input.is_class_day, false)[0] }
}
