import { z } from 'zod'
import type { TeacherAttendancePolicy } from '@/lib/teacher-attendance-policy'
export type { TeacherAttendancePolicy } from '@/lib/teacher-attendance-policy'

const timeFromDatabaseSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?$/)
const policyRowSchema = z.object({
  classroom_id: z.string().uuid(),
  timezone: z.literal('America/Toronto'),
  opens_local: timeFromDatabaseSchema,
  closes_local: timeFromDatabaseSchema,
  close_day_offset: z.union([z.literal(0), z.literal(1)]),
  entry_opens_minutes_before: z.number().int().min(0).max(720),
  present_grace_minutes: z.number().int().min(0).max(720),
  entry_closes_minutes_before_end: z.number().int().min(0).max(720),
  absent_minutes_before_end: z.number().int().min(0).max(720),
  enabled: z.boolean(),
  policy_revision: z.number().int().safe().positive(),
  updated_at: z.string().datetime({ offset: true }),
}).strict()

const savedPolicySchema = z.object({
  classroom_id: z.string().uuid(),
  timezone: z.literal('America/Toronto'),
  session_starts_local: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  session_ends_local: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  session_end_day_offset: z.union([z.literal(0), z.literal(1)]),
  entry_opens_minutes_before: z.number().int().min(0).max(720),
  present_grace_minutes: z.number().int().min(0).max(720),
  entry_closes_minutes_before_end: z.number().int().min(0).max(720),
  absent_minutes_before_end: z.number().int().min(0).max(720),
  enabled: z.boolean(),
  revision: z.number().int().safe().positive(),
  updated_at: z.string().datetime({ offset: true }),
}).strict()

export class TeacherAttendancePolicyError extends Error {
  constructor(readonly code: 'migration_required' | 'conflict' | 'read_failed' | 'invalid_result') {
    super(code)
    this.name = 'TeacherAttendancePolicyError'
  }
}

function isMigrationError(error: { code?: string } | null) {
  return error?.code === '42P01' || error?.code === '42883' || error?.code === 'PGRST202' || error?.code === 'PGRST205'
}

function toPolicy(row: z.infer<typeof policyRowSchema>): TeacherAttendancePolicy {
  return {
    classroomId: row.classroom_id,
    timezone: row.timezone,
    sessionStartsLocal: row.opens_local.slice(0, 5),
    sessionEndsLocal: row.closes_local.slice(0, 5),
    sessionEndDayOffset: row.close_day_offset,
    entryOpensMinutesBefore: row.entry_opens_minutes_before,
    presentGraceMinutes: row.present_grace_minutes,
    entryClosesMinutesBeforeEnd: row.entry_closes_minutes_before_end,
    absentMinutesBeforeEnd: row.absent_minutes_before_end,
    enabled: row.enabled,
    revision: row.policy_revision,
    updatedAt: row.updated_at,
  }
}

export async function loadTeacherAttendancePolicy(input: {
  supabase: any
  classroomId: string
}): Promise<TeacherAttendancePolicy | null> {
  const { data, error } = await input.supabase
    .from('attendance_window_policies')
    .select('classroom_id, timezone, opens_local, closes_local, close_day_offset, entry_opens_minutes_before, present_grace_minutes, entry_closes_minutes_before_end, absent_minutes_before_end, enabled, policy_revision, updated_at')
    .eq('classroom_id', input.classroomId)
    .maybeSingle()
  if (error) {
    throw new TeacherAttendancePolicyError(isMigrationError(error) ? 'migration_required' : 'read_failed')
  }
  if (data === null) return null
  const parsed = policyRowSchema.safeParse(data)
  if (!parsed.success) throw new TeacherAttendancePolicyError('invalid_result')
  return toPolicy(parsed.data)
}

export async function saveTeacherAttendancePolicy(input: {
  supabase: any
  teacherId: string
  classroomId: string
  sessionStartsLocal: string
  sessionEndsLocal: string
  sessionEndDayOffset: 0 | 1
  entryOpensMinutesBefore: number
  presentGraceMinutes: number
  entryClosesMinutesBeforeEnd: number
  absentMinutesBeforeEnd: number
  enabled: boolean
  expectedRevision: number | null
}): Promise<TeacherAttendancePolicy> {
  const { data, error } = await input.supabase.rpc(
    'upsert_attendance_timing_policy_v1', {
    p_teacher_id: input.teacherId,
    p_classroom_id: input.classroomId,
    p_session_starts_local: input.sessionStartsLocal,
    p_session_ends_local: input.sessionEndsLocal,
    p_session_end_day_offset: input.sessionEndDayOffset,
    p_entry_opens_minutes_before: input.entryOpensMinutesBefore,
    p_present_grace_minutes: input.presentGraceMinutes,
    p_entry_closes_minutes_before_end: input.entryClosesMinutesBeforeEnd,
    p_absent_minutes_before_end: input.absentMinutesBeforeEnd,
    p_enabled: input.enabled,
    p_expected_revision: input.expectedRevision,
    p_at: new Date().toISOString(),
  })
  if (error) {
    if (isMigrationError(error)) throw new TeacherAttendancePolicyError('migration_required')
    if (error.code === '40001' || error.message?.includes('attendance_policy_revision_conflict')) {
      throw new TeacherAttendancePolicyError('conflict')
    }
    throw new TeacherAttendancePolicyError('read_failed')
  }
  const parsed = savedPolicySchema.safeParse(data)
  if (!parsed.success) throw new TeacherAttendancePolicyError('invalid_result')
  return {
    classroomId: parsed.data.classroom_id,
    timezone: parsed.data.timezone,
    sessionStartsLocal: parsed.data.session_starts_local,
    sessionEndsLocal: parsed.data.session_ends_local,
    sessionEndDayOffset: parsed.data.session_end_day_offset,
    entryOpensMinutesBefore: parsed.data.entry_opens_minutes_before,
    presentGraceMinutes: parsed.data.present_grace_minutes,
    entryClosesMinutesBeforeEnd: parsed.data.entry_closes_minutes_before_end,
    absentMinutesBeforeEnd: parsed.data.absent_minutes_before_end,
    enabled: parsed.data.enabled,
    revision: parsed.data.revision,
    updatedAt: parsed.data.updated_at,
  }
}
