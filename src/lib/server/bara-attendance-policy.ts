import { z } from 'zod'
import { getBaraAttendanceScopeMode } from '@/lib/server/bara-attendance-scope'

const timeFromDatabaseSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?$/)
const policyRowSchema = z.object({
  classroom_id: z.string().uuid(),
  timezone: z.literal('America/Toronto'),
  opens_local: timeFromDatabaseSchema,
  closes_local: timeFromDatabaseSchema,
  close_day_offset: z.union([z.literal(0), z.literal(1)]),
  enabled: z.boolean(),
  policy_revision: z.number().int().safe().positive(),
  updated_at: z.string().datetime({ offset: true }),
}).strict()

const savedPolicySchema = z.object({
  classroom_id: z.string().uuid(),
  timezone: z.literal('America/Toronto'),
  opens_local: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  closes_local: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  close_day_offset: z.union([z.literal(0), z.literal(1)]),
  enabled: z.boolean(),
  revision: z.number().int().safe().positive(),
  updated_at: z.string().datetime({ offset: true }),
}).strict()

export interface TeacherAttendancePolicy {
  classroomId: string
  timezone: 'America/Toronto'
  opensLocal: string
  closesLocal: string
  closeDayOffset: 0 | 1
  enabled: boolean
  revision: number
  updatedAt: string
}

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
    opensLocal: row.opens_local.slice(0, 5),
    closesLocal: row.closes_local.slice(0, 5),
    closeDayOffset: row.close_day_offset,
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
    .select('classroom_id, timezone, opens_local, closes_local, close_day_offset, enabled, policy_revision, updated_at')
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
  opensLocal: string
  closesLocal: string
  closeDayOffset: 0 | 1
  enabled: boolean
  expectedRevision: number | null
}): Promise<TeacherAttendancePolicy> {
  const scopeMode = getBaraAttendanceScopeMode()
  const { data, error } = await input.supabase.rpc(
    scopeMode === 'teacher_entitlements'
      ? 'upsert_attendance_window_policy_v2'
      : 'upsert_attendance_window_policy_v1', {
    p_teacher_id: input.teacherId,
    p_classroom_id: input.classroomId,
    p_opens_local: input.opensLocal,
    p_closes_local: input.closesLocal,
    p_close_day_offset: input.closeDayOffset,
    p_enabled: input.enabled,
    p_expected_revision: input.expectedRevision,
    ...(scopeMode === 'teacher_entitlements'
      ? { p_at: new Date().toISOString() }
      : {}),
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
    opensLocal: parsed.data.opens_local,
    closesLocal: parsed.data.closes_local,
    closeDayOffset: parsed.data.close_day_offset,
    enabled: parsed.data.enabled,
    revision: parsed.data.revision,
    updatedAt: parsed.data.updated_at,
  }
}
