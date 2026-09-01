import {
  DEFAULT_MANUAL_ATTENDANCE_SETTINGS,
  type ManualAttendanceSettings,
  type ManualAttendanceSourceMode,
  type ManualAttendanceStatus,
  type ManualAttendanceView,
} from '@/lib/manual-attendance'

export class ManualAttendanceStoreError extends Error {
  constructor(readonly code: 'migration_required' | 'roster_changed' | 'unavailable') {
    super(code)
    this.name = 'ManualAttendanceStoreError'
  }
}

function isMissingRelation(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === '42P01' || error?.message?.includes('manual_attendance_') === true
}

function mapStoreError(error: { code?: string; message?: string } | null | undefined): never {
  if (isMissingRelation(error)) throw new ManualAttendanceStoreError('migration_required')
  throw new ManualAttendanceStoreError('unavailable')
}

function localTime(value: unknown) {
  return typeof value === 'string' && value.length >= 5 ? value.slice(0, 5) : null
}

function parseSettings(row: any): ManualAttendanceSettings {
  if (!row) return DEFAULT_MANUAL_ATTENDANCE_SETTINGS
  return {
    sourceMode: row.source_mode === 'log' ? 'log' : 'manual',
    sessionStartsLocal: localTime(row.session_starts_local),
    sessionEndsLocal: localTime(row.session_ends_local),
  }
}

export async function loadManualAttendanceView(input: {
  supabase: any
  classroomId: string
  classDate: string
}): Promise<ManualAttendanceView> {
  const [settingsResult, marksResult] = await Promise.all([
    input.supabase
      .from('manual_attendance_settings')
      .select('source_mode, session_starts_local, session_ends_local')
      .eq('classroom_id', input.classroomId)
      .maybeSingle(),
    input.supabase
      .from('manual_attendance_marks')
      .select('student_id, status')
      .eq('classroom_id', input.classroomId)
      .eq('class_date', input.classDate),
  ])

  if (settingsResult.error) mapStoreError(settingsResult.error)
  if (marksResult.error) mapStoreError(marksResult.error)

  const overrides = (marksResult.data ?? []).flatMap((row: any) => (
    typeof row.student_id === 'string'
      && (row.status === 'present' || row.status === 'late' || row.status === 'absent')
      ? [{ studentId: row.student_id, status: row.status as ManualAttendanceStatus }]
      : []
  ))

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
  sourceMode: ManualAttendanceSourceMode
  sessionStartsLocal: string | null
  sessionEndsLocal: string | null
}): Promise<ManualAttendanceSettings> {
  const { data, error } = await input.supabase
    .from('manual_attendance_settings')
    .upsert({
      classroom_id: input.classroomId,
      source_mode: input.sourceMode,
      session_starts_local: input.sessionStartsLocal,
      session_ends_local: input.sessionEndsLocal,
      updated_by: input.teacherId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'classroom_id' })
    .select('source_mode, session_starts_local, session_ends_local')
    .single()

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
  const { data: enrollmentRows, error: enrollmentError } = await input.supabase
    .from('classroom_enrollments')
    .select('student_id')
    .eq('classroom_id', input.classroomId)
    .in('student_id', input.studentIds)
  if (enrollmentError) throw new ManualAttendanceStoreError('unavailable')

  const enrolled = new Set((enrollmentRows ?? []).map((row: any) => row.student_id))
  if (input.studentIds.some((studentId) => !enrolled.has(studentId))) {
    throw new ManualAttendanceStoreError('roster_changed')
  }

  if (input.status === 'automatic') {
    const { error } = await input.supabase
      .from('manual_attendance_marks')
      .delete()
      .eq('classroom_id', input.classroomId)
      .eq('class_date', input.classDate)
      .in('student_id', input.studentIds)
    if (error) mapStoreError(error)
    return
  }

  const now = new Date().toISOString()
  const { error } = await input.supabase
    .from('manual_attendance_marks')
    .upsert(input.studentIds.map((studentId) => ({
      classroom_id: input.classroomId,
      class_date: input.classDate,
      student_id: studentId,
      status: input.status,
      updated_by: input.teacherId,
      updated_at: now,
    })), { onConflict: 'classroom_id,class_date,student_id' })
  if (error) mapStoreError(error)
}
