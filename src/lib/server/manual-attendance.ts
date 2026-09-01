import {
  DEFAULT_MANUAL_ATTENDANCE_SETTINGS,
  type ManualAttendanceSettings,
  type ManualAttendanceSourceMode,
  type ManualAttendanceStatus,
  type ManualAttendanceView,
} from '@/lib/manual-attendance'

export class ManualAttendanceStoreError extends Error {
  constructor(readonly code: 'migration_required' | 'roster_changed' | 'stale_revision' | 'unavailable') {
    super(code)
    this.name = 'ManualAttendanceStoreError'
  }
}

function isMissingRelation(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === '42P01'
    || error?.code === '42703'
    || error?.code === '42883'
    || error?.code === 'PGRST202'
    || error?.code === 'PGRST204'
    || error?.code === 'PGRST205'
}

function mapStoreError(error: { code?: string; message?: string } | null | undefined): never {
  if (isMissingRelation(error)) throw new ManualAttendanceStoreError('migration_required')
  if (error?.code === '23503') throw new ManualAttendanceStoreError('roster_changed')
  if (error?.code === '40001') throw new ManualAttendanceStoreError('stale_revision')
  throw new ManualAttendanceStoreError('unavailable')
}

function localTime(value: unknown) {
  return typeof value === 'string' && value.length >= 5 ? value.slice(0, 5) : null
}

function parseSettings(row: any): ManualAttendanceSettings {
  if (!row) return DEFAULT_MANUAL_ATTENDANCE_SETTINGS
  const sourceMode = row.manual_attendance_source_mode ?? row.source_mode
  const startsAt = row.manual_attendance_session_starts_local ?? row.session_starts_local
  const endsAt = row.manual_attendance_session_ends_local ?? row.session_ends_local
  const revision = row.manual_attendance_revision ?? row.revision
  return {
    sourceMode: sourceMode === 'log' ? 'log' : 'manual',
    sessionStartsLocal: localTime(startsAt),
    sessionEndsLocal: localTime(endsAt),
    revision: Number.isSafeInteger(revision) && revision > 0
      ? revision
      : 1,
  }
}

function markForDate(value: unknown, classDate: string): ManualAttendanceStatus | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const status = (value as Record<string, unknown>)[classDate]
  return status === 'present' || status === 'late' || status === 'absent'
    ? status
    : null
}

export async function loadManualAttendanceView(input: {
  supabase: any
  classroomId: string
  classDate: string
}): Promise<ManualAttendanceView> {
  const [settingsResult, marksResult] = await Promise.all([
    input.supabase
      .from('classrooms')
      .select('manual_attendance_source_mode, manual_attendance_session_starts_local, manual_attendance_session_ends_local, manual_attendance_revision')
      .eq('id', input.classroomId)
      .single(),
    input.supabase
      .from('classroom_enrollments')
      .select('student_id, manual_attendance_marks')
      .eq('classroom_id', input.classroomId),
  ])

  if (settingsResult.error) mapStoreError(settingsResult.error)
  if (marksResult.error) mapStoreError(marksResult.error)

  const overrides = (marksResult.data ?? []).flatMap((row: any) => {
    const status = markForDate(row.manual_attendance_marks, input.classDate)
    return typeof row.student_id === 'string' && status
      ? [{ studentId: row.student_id, status }]
      : []
  })

  return {
    classroomId: input.classroomId,
    classDate: input.classDate,
    settings: parseSettings(settingsResult.data),
    overrides,
  }
}

export async function saveManualAttendanceSettings(input: {
  supabase: any
  teacherId: string
  classroomId: string
  expectedRevision: number
  sourceMode: ManualAttendanceSourceMode
  sessionStartsLocal: string | null
  sessionEndsLocal: string | null
}): Promise<ManualAttendanceSettings> {
  const { data, error } = await input.supabase.rpc(
    'set_pika_manual_attendance_settings',
    {
      p_teacher_id: input.teacherId,
      p_classroom_id: input.classroomId,
      p_expected_revision: input.expectedRevision,
      p_source_mode: input.sourceMode,
      p_session_starts_local: input.sessionStartsLocal,
      p_session_ends_local: input.sessionEndsLocal,
    },
  )

  if (error) mapStoreError(error)
  return parseSettings(data)
}

export async function saveManualAttendanceMarks(input: {
  supabase: any
  teacherId: string
  classroomId: string
  classDate: string
  studentIds: string[]
  status: ManualAttendanceStatus | 'automatic'
}) {
  const { error } = await input.supabase.rpc('set_pika_manual_attendance_marks', {
    p_teacher_id: input.teacherId,
    p_classroom_id: input.classroomId,
    p_class_date: input.classDate,
    p_student_ids: input.studentIds,
    p_status: input.status,
  })
  if (error) mapStoreError(error)
}
