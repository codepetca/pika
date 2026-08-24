import { z } from 'zod'

import { getBaraAttendanceIntegrationState } from '@/lib/server/bara-attendance-client'
import { getBaraAttendanceCanaryScope } from '@/lib/server/bara-attendance-canary'
import { getBaraAttendanceScopeMode } from '@/lib/server/bara-attendance-scope'
import { addDaysToDateString } from '@/lib/date-string'
import { formatDateInToronto, toTorontoStartOfDayIso } from '@/lib/timezone'
import type {
  StudentAttendanceClassroomState,
  StudentAttendanceStatusView,
} from '@/lib/validations/student-attendance'

const MAX_STUDENT_CLASSROOMS = 50
const MAX_STUDENT_OCCURRENCES = MAX_STUDENT_CLASSROOMS * 2
const OPEN_REFRESH_MS = 15_000
const SCHEDULED_REFRESH_MS = 60_000

const enrollmentRowsSchema = z.array(z.object({
  classroom_id: z.string().uuid(),
}).strict()).max(MAX_STUDENT_CLASSROOMS)

const classroomRowsSchema = z.array(z.object({
  id: z.string().uuid(),
  teacher_id: z.string().uuid(),
}).strict()).max(MAX_STUDENT_CLASSROOMS)

const entitlementRowsSchema = z.array(z.object({
  teacher_id: z.string().uuid(),
}).strict()).max(MAX_STUDENT_CLASSROOMS)

const rosterRowsSchema = z.array(z.object({
  classroom_id: z.string().uuid(),
  integration_state: z.enum(['active', 'deactivating', 'inactive']),
}).strict()).max(MAX_STUDENT_CLASSROOMS)

const occurrenceRowsSchema = z.array(z.object({
  classroom_id: z.string().uuid(),
  class_date: z.string().date(),
  occurrence_ref: z.string().min(1).max(128),
  opens_at: z.string().datetime({ offset: true }).nullable(),
  closes_at: z.string().datetime({ offset: true }).nullable(),
  desired_state: z.enum(['scheduled', 'cancelled']),
}).strict()).max(MAX_STUDENT_OCCURRENCES)

const sessionRowsSchema = z.array(z.object({
  occurrence_ref: z.string().min(1).max(128),
  status: z.enum(['scheduled', 'open', 'closed', 'cancelled']),
  opens_at: z.string().datetime({ offset: true }).nullable(),
  closes_at: z.string().datetime({ offset: true }).nullable(),
}).strict()).max(MAX_STUDENT_OCCURRENCES)

const recordRowsSchema = z.array(z.object({
  classroom_id: z.string().uuid(),
  occurrence_ref: z.string().min(1).max(128),
  status: z.enum(['unmarked', 'present', 'late', 'absent']),
  last_event_at: z.string().datetime({ offset: true }),
}).strict()).max(MAX_STUDENT_OCCURRENCES)

type OccurrenceRow = z.infer<typeof occurrenceRowsSchema>[number]
type SessionRow = z.infer<typeof sessionRowsSchema>[number]
type RecordRow = z.infer<typeof recordRowsSchema>[number]

export class StudentAttendanceStatusReadError extends Error {
  constructor(readonly code: 'read_failed' | 'invalid_projection') {
    super(code)
    this.name = 'StudentAttendanceStatusReadError'
  }
}

function parseRows<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data ?? [])
  if (!parsed.success) throw new StudentAttendanceStatusReadError('invalid_projection')
  return parsed.data
}

function assertRead(result: { error: unknown }) {
  if (result.error) throw new StudentAttendanceStatusReadError('read_failed')
}

function unavailableState(classroomId: string): StudentAttendanceClassroomState {
  return {
    classroomId,
    state: 'unavailable',
    opensAt: null,
    closesAt: null,
  }
}

function minInstant(current: string | null, candidate: string | null): string | null {
  if (!candidate) return current
  if (!current) return candidate
  return Date.parse(candidate) < Date.parse(current) ? candidate : current
}

function nextTorontoDayBoundary(now: Date): string {
  return toTorontoStartOfDayIso(
    addDaysToDateString(formatDateInToronto(now), 1),
  )
}

function confirmedValidityBoundary(
  occurrence: OccurrenceRow | null,
  closesAt: string | null,
  now: Date,
): string {
  const dayBoundary = occurrence
    ? toTorontoStartOfDayIso(addDaysToDateString(occurrence.class_date, 1))
    : nextTorontoDayBoundary(now)
  if (!closesAt || !Number.isFinite(Date.parse(closesAt))) return dayBoundary
  return new Date(Math.max(Date.parse(dayBoundary), Date.parse(closesAt))).toISOString()
}

export function buildStudentAttendanceClassroomState(input: {
  classroomId: string
  occurrence: OccurrenceRow | null
  session: SessionRow | null
  record: RecordRow | null
  now: Date
}): { state: StudentAttendanceClassroomState; nextRefreshAt: string | null } {
  const { classroomId, occurrence, session, record, now } = input
  const ownConfirmedStatus = record?.status === 'present' || record?.status === 'late'
    ? record.status
    : null
  const opensAt = session?.opens_at ?? occurrence?.opens_at ?? null
  const closesAt = session?.closes_at ?? occurrence?.closes_at ?? null

  if (record && ownConfirmedStatus) {
    const closesTime = closesAt ? Date.parse(closesAt) : Number.NaN
    const shouldRefreshBeforeClose = Number.isFinite(closesTime) && now.getTime() < closesTime
    const validUntil = confirmedValidityBoundary(occurrence, closesAt, now)
    return {
      state: {
        classroomId,
        state: 'confirmed',
        opensAt,
        closesAt,
        attendanceStatus: ownConfirmedStatus,
        confirmedAt: record.last_event_at,
        validUntil,
      },
      nextRefreshAt: shouldRefreshBeforeClose
        ? new Date(Math.min(now.getTime() + OPEN_REFRESH_MS, closesTime)).toISOString()
        : validUntil,
    }
  }

  if (!occurrence) {
    return {
      state: { classroomId, state: 'no_session', opensAt: null, closesAt: null },
      nextRefreshAt: nextTorontoDayBoundary(now),
    }
  }

  const opensTime = opensAt ? Date.parse(opensAt) : Number.NaN
  const closesTime = closesAt ? Date.parse(closesAt) : Number.NaN
  const isClosed = occurrence.desired_state === 'cancelled'
    || session?.status === 'closed'
    || session?.status === 'cancelled'
    || (Number.isFinite(closesTime) && now.getTime() >= closesTime)
  if (isClosed) {
    return {
      state: { classroomId, state: 'closed', opensAt, closesAt },
      nextRefreshAt: nextTorontoDayBoundary(now),
    }
  }

  const isOpen = session?.status === 'open'
    && Number.isFinite(closesTime)
    && now.getTime() < closesTime
    && (!Number.isFinite(opensTime) || now.getTime() >= opensTime)
  if (isOpen) {
    return {
      state: { classroomId, state: 'open', opensAt, closesAt },
      nextRefreshAt: new Date(
        Math.min(now.getTime() + OPEN_REFRESH_MS, closesTime),
      ).toISOString(),
    }
  }

  const scheduledRefresh = Number.isFinite(opensTime) && opensTime > now.getTime()
    ? new Date(Math.min(opensTime, now.getTime() + SCHEDULED_REFRESH_MS)).toISOString()
    : new Date(now.getTime() + SCHEDULED_REFRESH_MS).toISOString()
  return {
    state: { classroomId, state: 'scheduled', opensAt, closesAt },
    nextRefreshAt: scheduledRefresh,
  }
}

export async function loadStudentAttendanceStatusView(input: {
  supabase: any
  studentId: string
  now?: Date
  integrationState?: 'disabled' | 'not_configured' | 'ready'
}): Promise<StudentAttendanceStatusView> {
  const now = input.now ?? new Date()
  const serverNow = now.toISOString()
  const enrollmentResult = await input.supabase
    .from('classroom_enrollments')
    .select('classroom_id')
    .eq('student_id', input.studentId)
    .order('created_at', { ascending: false })
    .limit(MAX_STUDENT_CLASSROOMS)
  assertRead(enrollmentResult)
  const enrollments = parseRows(enrollmentRowsSchema, enrollmentResult.data)
  const enrolledIds = enrollments.map((row) => row.classroom_id)
  if (enrolledIds.length === 0) {
    return { studentId: input.studentId, classrooms: [], nextRefreshAt: null, serverNow }
  }

  const classroomResult = await input.supabase
    .from('classrooms')
    .select('id, teacher_id')
    .in('id', enrolledIds)
    .is('archived_at', null)
    .limit(MAX_STUDENT_CLASSROOMS)
  assertRead(classroomResult)
  const classrooms = parseRows(classroomRowsSchema, classroomResult.data)
  const integration = input.integrationState ?? getBaraAttendanceIntegrationState()
  if (integration !== 'ready') {
    return {
      studentId: input.studentId,
      classrooms: classrooms.map((row) => unavailableState(row.id)),
      nextRefreshAt: null,
      serverNow,
    }
  }

  let readyClassroomIds: string[] = []
  if (getBaraAttendanceScopeMode() === 'exact_canary') {
    const canary = getBaraAttendanceCanaryScope()
    if (
      canary.state === 'ready'
      && canary.classroomId
      && canary.teacherId
      && classrooms.some((row) => row.id === canary.classroomId && row.teacher_id === canary.teacherId)
    ) {
      readyClassroomIds = [canary.classroomId]
    }
  } else {
    const teacherIds = [...new Set(classrooms.map((row) => row.teacher_id))]
    const [entitlementResult, rosterResult] = await Promise.all([
      input.supabase
        .from('attendance_teacher_entitlements')
        .select('teacher_id')
        .in('teacher_id', teacherIds)
        .eq('status', 'active')
        .lte('valid_from', now.toISOString())
        .or(`valid_until.is.null,valid_until.gt.${now.toISOString()}`)
        .limit(MAX_STUDENT_CLASSROOMS),
      input.supabase
        .from('attendance_roster_mappings')
        .select('classroom_id, integration_state')
        .in('classroom_id', classrooms.map((row) => row.id))
        .limit(MAX_STUDENT_CLASSROOMS),
    ])
    assertRead(entitlementResult)
    assertRead(rosterResult)
    const entitledTeacherIds = new Set(
      parseRows(entitlementRowsSchema, entitlementResult.data).map((row) => row.teacher_id),
    )
    const rosterStateByClassroom = new Map(
      parseRows(rosterRowsSchema, rosterResult.data)
        .map((row) => [row.classroom_id, row.integration_state] as const),
    )
    readyClassroomIds = classrooms
      .filter((row) => (
        entitledTeacherIds.has(row.teacher_id)
        && (rosterStateByClassroom.get(row.id) ?? 'active') === 'active'
      ))
      .map((row) => row.id)
  }

  const readySet = new Set(readyClassroomIds)
  if (readyClassroomIds.length === 0) {
    return {
      studentId: input.studentId,
      classrooms: classrooms.map((row) => unavailableState(row.id)),
      nextRefreshAt: null,
      serverNow,
    }
  }

  const today = formatDateInToronto(now)
  const previousDay = addDaysToDateString(today, -1)
  const occurrenceResult = await input.supabase
    .from('attendance_occurrence_mappings')
    .select('classroom_id, class_date, occurrence_ref, opens_at, closes_at, desired_state')
    .in('classroom_id', readyClassroomIds)
    .in('class_date', [previousDay, today])
    .limit(MAX_STUDENT_OCCURRENCES)
  assertRead(occurrenceResult)
  const occurrences = parseRows(occurrenceRowsSchema, occurrenceResult.data)
  const occurrenceRefs = occurrences.map((row) => row.occurrence_ref)

  let sessions: SessionRow[] = []
  let records: RecordRow[] = []
  if (occurrenceRefs.length > 0) {
    const installationRef = process.env.BARA_ATTENDANCE_INSTALLATION_REF?.trim() ?? ''
    if (!/^[A-Za-z0-9._~-]{1,128}$/.test(installationRef)) {
      throw new StudentAttendanceStatusReadError('read_failed')
    }
    const [sessionResult, recordResult] = await Promise.all([
      input.supabase
        .from('attendance_session_projection')
        .select('occurrence_ref, status, opens_at, closes_at')
        .eq('installation_ref', installationRef)
        .in('occurrence_ref', occurrenceRefs)
        .limit(MAX_STUDENT_OCCURRENCES),
      input.supabase
        .from('attendance_record_projection')
        .select('classroom_id, occurrence_ref, status, last_event_at')
        .eq('installation_ref', installationRef)
        .eq('student_id', input.studentId)
        .in('occurrence_ref', occurrenceRefs)
        .limit(MAX_STUDENT_OCCURRENCES),
    ])
    assertRead(sessionResult)
    assertRead(recordResult)
    sessions = parseRows(sessionRowsSchema, sessionResult.data)
    records = parseRows(recordRowsSchema, recordResult.data)
  }

  const sessionByOccurrence = new Map(sessions.map((row) => [row.occurrence_ref, row]))
  const recordByOccurrence = new Map(records.map((row) => [row.occurrence_ref, row]))
  const occurrencesByClassroom = new Map<string, OccurrenceRow[]>()
  for (const occurrence of occurrences) {
    const rows = occurrencesByClassroom.get(occurrence.classroom_id) ?? []
    rows.push(occurrence)
    occurrencesByClassroom.set(occurrence.classroom_id, rows)
  }
  let nextRefreshAt: string | null = null
  const states = classrooms.map((classroom) => {
    if (!readySet.has(classroom.id)) return unavailableState(classroom.id)
    const classroomOccurrences = occurrencesByClassroom.get(classroom.id) ?? []
    const overnightOccurrence = classroomOccurrences.find((occurrence) => {
      if (occurrence.class_date !== previousDay || occurrence.desired_state === 'cancelled') {
        return false
      }
      const session = sessionByOccurrence.get(occurrence.occurrence_ref)
      const effectiveClosesAt = session?.closes_at ?? occurrence.closes_at
      const closesTime = effectiveClosesAt ? Date.parse(effectiveClosesAt) : Number.NaN
      if (!Number.isFinite(closesTime) || now.getTime() >= closesTime) return false
      const record = recordByOccurrence.get(occurrence.occurrence_ref)
      return session?.status === 'open' || record?.status === 'present' || record?.status === 'late'
    })
    const occurrence = overnightOccurrence
      ?? classroomOccurrences.find((row) => row.class_date === today)
      ?? null
    const built = buildStudentAttendanceClassroomState({
      classroomId: classroom.id,
      occurrence,
      session: occurrence ? sessionByOccurrence.get(occurrence.occurrence_ref) ?? null : null,
      record: occurrence ? recordByOccurrence.get(occurrence.occurrence_ref) ?? null : null,
      now,
    })
    nextRefreshAt = minInstant(nextRefreshAt, built.nextRefreshAt)
    return built.state
  })

  return { studentId: input.studentId, classrooms: states, nextRefreshAt, serverNow }
}
