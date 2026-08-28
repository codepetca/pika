import { z } from 'zod'

import { getBaraAttendanceIntegrationState } from '@/lib/server/bara-attendance-client'
import { getBaraAttendanceCanaryScope } from '@/lib/server/bara-attendance-canary'
import {
  AttendanceEntryTokenError,
  deriveStudentAttendanceOccurrenceBinding,
} from '@/lib/server/bara-attendance-entry-token'
import { getBaraAttendanceScopeMode } from '@/lib/server/bara-attendance-scope'
import { addDaysToDateString } from '@/lib/date-string'
import { formatDateInToronto, toTorontoStartOfDayIso } from '@/lib/timezone'
import type {
  StudentAttendanceClassroomState,
  StudentAttendanceStatusView,
} from '@/lib/validations/student-attendance'

const MAX_STUDENT_CLASSROOMS = 50
const MAX_STUDENT_OCCURRENCES = MAX_STUDENT_CLASSROOMS * 2
const MAX_STUDENT_CHECK_INS = MAX_STUDENT_OCCURRENCES * 5
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
  present_through_at: z.string().datetime({ offset: true }).nullable(),
  absent_at: z.string().datetime({ offset: true }).nullable(),
  desired_state: z.enum(['scheduled', 'cancelled']),
}).strict()).max(MAX_STUDENT_OCCURRENCES)

const sessionRowsSchema = z.array(z.object({
  occurrence_ref: z.string().min(1).max(128),
  status: z.enum(['scheduled', 'open', 'closed', 'cancelled']),
  opens_at: z.string().datetime({ offset: true }).nullable(),
  closes_at: z.string().datetime({ offset: true }).nullable(),
}).strict()).max(MAX_STUDENT_OCCURRENCES)

const checkInRowsSchema = z.array(z.object({
  classroom_id: z.string().uuid(),
  occurrence_ref: z.string().min(1).max(128),
  check_in_ref: z.string().min(1).max(128),
  check_in_revision: z.number().int().positive(),
  accepted_at: z.string().datetime({ offset: true }),
  invalidated_at: z.string().datetime({ offset: true }).nullable(),
}).strict()).max(MAX_STUDENT_CHECK_INS)

const overrideRowsSchema = z.array(z.object({
  classroom_id: z.string().uuid(),
  occurrence_ref: z.string().min(1).max(128),
  status: z.enum(['present', 'late', 'absent']).nullable(),
  active: z.boolean(),
  revision: z.number().int().positive(),
  updated_at: z.string().datetime({ offset: true }),
}).strict()).max(MAX_STUDENT_OCCURRENCES)

type OccurrenceRow = z.infer<typeof occurrenceRowsSchema>[number]
type SessionRow = z.infer<typeof sessionRowsSchema>[number]
type CheckInRow = z.infer<typeof checkInRowsSchema>[number]
type OverrideRow = z.infer<typeof overrideRowsSchema>[number]

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
  checkIn: CheckInRow | null
  statusOverride: OverrideRow | null
  now: Date
}): { state: StudentAttendanceClassroomState; nextRefreshAt: string | null } {
  const { classroomId, occurrence, session, checkIn, statusOverride, now } = input
  const automaticStatus = checkIn && !checkIn.invalidated_at && occurrence?.present_through_at
    ? Date.parse(checkIn.accepted_at) <= Date.parse(occurrence.present_through_at)
      ? 'present' as const
      : 'late' as const
    : null
  const ownConfirmedStatus = statusOverride?.active
    && (statusOverride.status === 'present' || statusOverride.status === 'late')
    ? statusOverride.status
    : statusOverride?.active
      ? null
      : automaticStatus
  const confirmedAt = statusOverride?.active
    ? statusOverride.updated_at
    : checkIn?.accepted_at ?? null
  const opensAt = session?.opens_at ?? occurrence?.opens_at ?? null
  const closesAt = session?.closes_at ?? occurrence?.closes_at ?? null

  if (ownConfirmedStatus && confirmedAt) {
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
        confirmedAt,
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
    .select('classroom_id, class_date, occurrence_ref, opens_at, closes_at, present_through_at, absent_at, desired_state')
    .in('classroom_id', readyClassroomIds)
    .in('class_date', [previousDay, today])
    .limit(MAX_STUDENT_OCCURRENCES)
  assertRead(occurrenceResult)
  const occurrences = parseRows(occurrenceRowsSchema, occurrenceResult.data)
  const occurrenceRefs = occurrences.map((row) => row.occurrence_ref)

  let sessions: SessionRow[] = []
  let checkIns: CheckInRow[] = []
  let overrides: OverrideRow[] = []
  if (occurrenceRefs.length > 0) {
    const installationRef = process.env.BARA_ATTENDANCE_INSTALLATION_REF?.trim() ?? ''
    if (!/^[A-Za-z0-9._~-]{1,128}$/.test(installationRef)) {
      throw new StudentAttendanceStatusReadError('read_failed')
    }
    const [sessionResult, checkInResult, overrideResult] = await Promise.all([
      input.supabase
        .from('attendance_session_projection')
        .select('occurrence_ref, status, opens_at, closes_at')
        .eq('installation_ref', installationRef)
        .in('occurrence_ref', occurrenceRefs)
        .limit(MAX_STUDENT_OCCURRENCES),
      input.supabase
        .from('attendance_check_in_facts')
        .select('classroom_id, occurrence_ref, check_in_ref, check_in_revision, accepted_at, invalidated_at')
        .eq('installation_ref', installationRef)
        .eq('student_id', input.studentId)
        .in('occurrence_ref', occurrenceRefs)
        .limit(MAX_STUDENT_CHECK_INS),
      input.supabase
        .from('attendance_status_overrides')
        .select('classroom_id, occurrence_ref, status, active, revision, updated_at')
        .eq('student_id', input.studentId)
        .in('occurrence_ref', occurrenceRefs)
        .limit(MAX_STUDENT_OCCURRENCES),
    ])
    assertRead(sessionResult)
    assertRead(checkInResult)
    assertRead(overrideResult)
    sessions = parseRows(sessionRowsSchema, sessionResult.data)
    checkIns = parseRows(checkInRowsSchema, checkInResult.data)
    overrides = parseRows(overrideRowsSchema, overrideResult.data)
  }

  const sessionByOccurrence = new Map(sessions.map((row) => [row.occurrence_ref, row]))
  const checkInByOccurrence = new Map<string, CheckInRow>()
  for (const checkIn of checkIns) {
    if (checkIn.invalidated_at) continue
    const current = checkInByOccurrence.get(checkIn.occurrence_ref)
    if (!current || Date.parse(checkIn.accepted_at) > Date.parse(current.accepted_at)) {
      checkInByOccurrence.set(checkIn.occurrence_ref, checkIn)
    }
  }
  const overrideByOccurrence = new Map(overrides.map((row) => [row.occurrence_ref, row]))
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
      const checkIn = checkInByOccurrence.get(occurrence.occurrence_ref) ?? null
      const statusOverride = overrideByOccurrence.get(occurrence.occurrence_ref) ?? null
      const derived = buildStudentAttendanceClassroomState({
        classroomId: classroom.id, occurrence, session: session ?? null,
        checkIn, statusOverride, now,
      })
      return session?.status === 'open' || derived.state.state === 'confirmed'
    })
    const occurrence = overnightOccurrence
      ?? classroomOccurrences.find((row) => row.class_date === today)
      ?? null
    const built = buildStudentAttendanceClassroomState({
      classroomId: classroom.id,
      occurrence,
      session: occurrence ? sessionByOccurrence.get(occurrence.occurrence_ref) ?? null : null,
      checkIn: occurrence ? checkInByOccurrence.get(occurrence.occurrence_ref) ?? null : null,
      statusOverride: occurrence ? overrideByOccurrence.get(occurrence.occurrence_ref) ?? null : null,
      now,
    })
    nextRefreshAt = minInstant(nextRefreshAt, built.nextRefreshAt)
    if (!occurrence) return built.state
    try {
      return {
        ...built.state,
        occurrenceBinding: deriveStudentAttendanceOccurrenceBinding({
          studentId: input.studentId,
          occurrenceRef: occurrence.occurrence_ref,
        }),
      }
    } catch (error) {
      if (error instanceof AttendanceEntryTokenError) {
        throw new StudentAttendanceStatusReadError('read_failed')
      }
      throw error
    }
  })

  return { studentId: input.studentId, classrooms: states, nextRefreshAt, serverNow }
}
