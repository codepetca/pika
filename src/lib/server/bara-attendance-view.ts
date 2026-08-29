import { z } from 'zod'
import { loadAttendanceRoster } from '@/lib/server/attendance-report'
import type {
  TeacherAttendanceSessionState,
  TeacherAttendanceStatus,
  TeacherAttendanceView,
} from '@/lib/teacher-attendance'
import { validateV1Message } from '@/vendor/attendance-contract/v1/validate'

export type {
  TeacherAttendanceSessionState,
  TeacherAttendanceSource,
  TeacherAttendanceStatus,
  TeacherAttendanceView,
} from '@/lib/teacher-attendance'

interface OccurrenceInput {
  occurrenceRef: string
  opensAt: string
  closesAt: string
  sessionStartsAt?: string
  sessionEndsAt?: string
  presentThroughAt?: string
  absentAt?: string
}

interface SessionProjectionInput {
  occurrenceRef: string
  state: Exclude<TeacherAttendanceSessionState, 'not_scheduled'>
  revision: number
  updatedAt: string
  opensAt: string
  closesAt: string
}

interface CheckInFactInput {
  studentId: string
  checkInRef: string
  revision: number
  acceptedAt: string
  invalidatedAt: string | null
  updatedAt: string
}

interface StatusOverrideInput {
  studentId: string
  status: Exclude<TeacherAttendanceStatus, 'unmarked'> | null
  active: boolean
  revision: number
  updatedAt: string
}

export interface BuildTeacherAttendanceViewInput {
  classroomId: string
  classDate: string
  integration: TeacherAttendanceView['integration']
  students: Array<{ studentId: string; firstName: string; lastName: string }>
  participantMappings?: Array<{ studentId: string; participantRef: string }>
  occurrence: OccurrenceInput | null
  sessionProjection: SessionProjectionInput | null
  checkInFacts?: CheckInFactInput[]
  statusOverrides?: StatusOverrideInput[]
  pendingCheckInRefs?: string[]
  pendingSessionCommand?: boolean
  failedSessionCommand?: boolean
  projectionKnownStale?: boolean
  now?: string
  // Retained only so callers compiled against the old builder fail softly
  // while the pre-release contract is updated in one branch.
  recordProjections?: unknown[]
  pendingStudentIds?: string[]
  failedStudentIds?: string[]
}

type QueryResult = Promise<{ data: unknown; error: { code?: string; message?: string } | null }>
const opaqueRefSchema = z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/)
const revisionSchema = z.number().int().safe().positive()
const instantSchema = z.string().datetime({ offset: true })

const participantRowsSchema = z.array(z.object({
  student_id: z.string().uuid(), participant_ref: opaqueRefSchema,
}).strict())
const occurrenceRowSchema = z.object({
  occurrence_ref: opaqueRefSchema,
  opens_at: instantSchema.nullable(),
  closes_at: instantSchema.nullable(),
  session_starts_at: instantSchema.nullable(),
  session_ends_at: instantSchema.nullable(),
  present_through_at: instantSchema.nullable(),
  absent_at: instantSchema.nullable(),
}).strict().nullable()
const policyRowSchema = z.object({ enabled: z.boolean() }).strict().nullable()
const sessionRowSchema = z.object({
  occurrence_ref: opaqueRefSchema,
  status: z.enum(['scheduled', 'open', 'closed', 'cancelled']),
  opens_at: instantSchema.nullable(), closes_at: instantSchema.nullable(),
  session_revision: revisionSchema, updated_at: instantSchema,
}).strict().nullable()
const checkInRowsSchema = z.array(z.object({
  student_id: z.string().uuid(),
  check_in_ref: opaqueRefSchema,
  check_in_revision: revisionSchema,
  accepted_at: instantSchema,
  invalidated_at: instantSchema.nullable(),
  updated_at: instantSchema,
}).strict())
const overrideRowsSchema = z.array(z.object({
  student_id: z.string().uuid(),
  status: z.enum(['present', 'late', 'absent']).nullable(),
  active: z.boolean(), revision: revisionSchema, updated_at: instantSchema,
}).strict())
const outboxRowsSchema = z.array(z.object({
  message_type: z.enum([
    'roster.snapshot', 'schedule.snapshot', 'session.command', 'check_in.invalidate',
  ]),
  payload: z.unknown(), status: z.enum(['pending', 'processing', 'non_retryable']),
  lease_expires_at: instantSchema.nullable(), updated_at: instantSchema,
}).strict())

export class TeacherAttendanceViewReadError extends Error {
  constructor(readonly code: 'migration_required' | 'read_failed' | 'invalid_projection') {
    super(code)
    this.name = 'TeacherAttendanceViewReadError'
  }
}

function readError(error: { code?: string } | null): never {
  throw new TeacherAttendanceViewReadError(
    error?.code === '42P01' || error?.code === 'PGRST205' ? 'migration_required' : 'read_failed',
  )
}

async function selectMany(client: any, table: string, columns: string, filters: string[][]): QueryResult {
  let query: any = client.from(table).select(columns)
  for (const [column, value] of filters) query = query.eq(column, value)
  return await query
}

async function selectMaybeOne(client: any, table: string, columns: string, filters: string[][]): QueryResult {
  let query: any = client.from(table).select(columns)
  for (const [column, value] of filters) query = query.eq(column, value)
  return await query.maybeSingle()
}

export async function loadTeacherAttendanceView(input: {
  supabase: any
  classroomId: string
  classDate: string
  integration: TeacherAttendanceView['integration']
  installationRef?: string
}): Promise<TeacherAttendanceView> {
  const roster = await loadAttendanceRoster(input.supabase, input.classroomId)
  if (roster.enrollmentsError || roster.profilesError) throw new TeacherAttendanceViewReadError('read_failed')
  const students = roster.students.map((student) => ({
    studentId: student.id, firstName: student.first_name, lastName: student.last_name,
  }))
  const empty = () => buildTeacherAttendanceView({
    classroomId: input.classroomId, classDate: input.classDate, integration: input.integration,
    students, occurrence: null, sessionProjection: null,
  })
  if (input.integration !== 'ready') return empty()

  const installationRef = input.installationRef ?? process.env.BARA_ATTENDANCE_INSTALLATION_REF?.trim()
  if (!installationRef || !opaqueRefSchema.safeParse(installationRef).success) {
    throw new TeacherAttendanceViewReadError('read_failed')
  }
  const [participantsResult, occurrenceResult, policyResult] = await Promise.all([
    selectMany(input.supabase, 'attendance_participant_mappings', 'student_id, participant_ref',
      [['classroom_id', input.classroomId]]),
    selectMaybeOne(input.supabase, 'attendance_occurrence_mappings',
      'occurrence_ref, opens_at, closes_at, session_starts_at, session_ends_at, present_through_at, absent_at',
      [['classroom_id', input.classroomId], ['class_date', input.classDate]]),
    selectMaybeOne(input.supabase, 'attendance_window_policies', 'enabled',
      [['classroom_id', input.classroomId]]),
  ])
  for (const result of [participantsResult, occurrenceResult, policyResult]) if (result.error) readError(result.error)
  const participants = participantRowsSchema.safeParse(participantsResult.data ?? [])
  const occurrence = occurrenceRowSchema.safeParse(occurrenceResult.data ?? null)
  const policy = policyRowSchema.safeParse(policyResult.data ?? null)
  if (!participants.success || !occurrence.success || !policy.success) {
    throw new TeacherAttendanceViewReadError('invalid_projection')
  }
  if (!occurrence.data?.opens_at || !occurrence.data.closes_at
    || !occurrence.data.session_starts_at || !occurrence.data.session_ends_at
    || !occurrence.data.present_through_at || !occurrence.data.absent_at) {
    return buildTeacherAttendanceView({
      classroomId: input.classroomId, classDate: input.classDate,
      integration: policy.data?.enabled ? 'ready' : 'not_configured',
      students, occurrence: null, sessionProjection: null,
    })
  }
  const occurrenceRow = occurrence.data
  const acceptsAt = occurrenceRow.opens_at!
  const stopsAcceptingAt = occurrenceRow.closes_at!
  const sessionStartsAt = occurrenceRow.session_starts_at!
  const sessionEndsAt = occurrenceRow.session_ends_at!
  const presentThroughAt = occurrenceRow.present_through_at!
  const absentAt = occurrenceRow.absent_at!
  const [sessionResult, checkInsResult, overridesResult, outboxResult] = await Promise.all([
    selectMaybeOne(input.supabase, 'attendance_session_projection',
      'occurrence_ref, status, opens_at, closes_at, session_revision, updated_at',
      [['installation_ref', installationRef], ['occurrence_ref', occurrenceRow.occurrence_ref]]),
    selectMany(input.supabase, 'attendance_check_in_facts',
      'student_id, check_in_ref, check_in_revision, accepted_at, invalidated_at, updated_at',
      [['installation_ref', installationRef], ['occurrence_ref', occurrenceRow.occurrence_ref]]),
    selectMany(input.supabase, 'attendance_status_overrides',
      'student_id, status, active, revision, updated_at',
      [['classroom_id', input.classroomId], ['occurrence_ref', occurrenceRow.occurrence_ref]]),
    input.supabase.from('attendance_integration_outbox')
      .select('message_type, payload, status, lease_expires_at, updated_at')
      .eq('classroom_id', input.classroomId).in('status', ['pending', 'processing', 'non_retryable']),
  ])
  for (const result of [sessionResult, checkInsResult, overridesResult, outboxResult]) if (result.error) readError(result.error)
  const session = sessionRowSchema.safeParse(sessionResult.data ?? null)
  const checkIns = checkInRowsSchema.safeParse(checkInsResult.data ?? [])
  const overrides = overrideRowsSchema.safeParse(overridesResult.data ?? [])
  const outbox = outboxRowsSchema.safeParse(outboxResult.data ?? [])
  if (!session.success || !checkIns.success || !overrides.success || !outbox.success) {
    throw new TeacherAttendanceViewReadError('invalid_projection')
  }

  const pendingCheckInRefs = new Set<string>()
  const failedCheckInRefs = new Set<string>()
  let pendingSessionCommand = false
  let failedSessionCommand = false
  const isPending = (row: z.infer<typeof outboxRowsSchema>[number]) => row.status === 'pending'
    || (row.status === 'processing' && row.lease_expires_at !== null
      && Date.parse(row.lease_expires_at) > Date.now())
  for (const row of outbox.data) {
    const validation = validateV1Message(row.payload)
    if (!validation.ok || validation.value.message_type !== row.message_type) {
      throw new TeacherAttendanceViewReadError('invalid_projection')
    }
    const message = validation.value
    if (!('occurrence_ref' in message) || message.occurrence_ref !== occurrenceRow.occurrence_ref) continue
    if (message.message_type === 'session.command') {
      if (isPending(row)) pendingSessionCommand = true
      else if (row.status === 'non_retryable') failedSessionCommand = true
    }
    if (message.message_type === 'check_in.invalidate') {
      const target = isPending(row)
        ? pendingCheckInRefs
        : row.status === 'non_retryable'
          ? failedCheckInRefs
          : null
      if (target) {
        for (const invalidation of message.invalidations) target.add(invalidation.check_in_ref)
      }
    }
  }

  return buildTeacherAttendanceView({
    classroomId: input.classroomId, classDate: input.classDate, integration: 'ready', students,
    occurrence: {
      occurrenceRef: occurrenceRow.occurrence_ref,
      opensAt: acceptsAt, closesAt: stopsAcceptingAt,
      sessionStartsAt, sessionEndsAt, presentThroughAt, absentAt,
    },
    sessionProjection: session.data ? {
      occurrenceRef: session.data.occurrence_ref, state: session.data.status,
      opensAt: session.data.opens_at ?? acceptsAt,
      closesAt: session.data.closes_at ?? stopsAcceptingAt,
      revision: session.data.session_revision, updatedAt: session.data.updated_at,
    } : null,
    checkInFacts: checkIns.data.map((row) => ({
      studentId: row.student_id, checkInRef: row.check_in_ref,
      revision: row.check_in_revision, acceptedAt: row.accepted_at,
      invalidatedAt: row.invalidated_at, updatedAt: row.updated_at,
    })),
    statusOverrides: overrides.data.map((row) => ({
      studentId: row.student_id, status: row.status, active: row.active,
      revision: row.revision, updatedAt: row.updated_at,
    })),
    pendingCheckInRefs: [...pendingCheckInRefs],
    failedStudentIds: checkIns.data
      .filter((fact) => !fact.invalidated_at && failedCheckInRefs.has(fact.check_in_ref))
      .map((fact) => fact.student_id),
    pendingSessionCommand,
    failedSessionCommand,
  })
}

function latestInstant(values: Array<string | null>) {
  return values.filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null
}

export function buildTeacherAttendanceView(input: BuildTeacherAttendanceViewInput): TeacherAttendanceView {
  const factsByStudent = new Map<string, CheckInFactInput>()
  for (const fact of input.checkInFacts ?? []) {
    if (fact.invalidatedAt) continue
    const current = factsByStudent.get(fact.studentId)
    if (!current || Date.parse(fact.acceptedAt) > Date.parse(current.acceptedAt)) {
      factsByStudent.set(fact.studentId, fact)
    }
  }
  const overrides = new Map((input.statusOverrides ?? []).map((item) => [item.studentId, item]))
  const pendingRefs = new Set(input.pendingCheckInRefs ?? [])
  const failedStudentIds = new Set(input.failedStudentIds ?? [])
  const projection = input.occurrence
    && input.sessionProjection?.occurrenceRef === input.occurrence.occurrenceRef
    ? input.sessionProjection : null
  const confirmedAt = latestInstant([
    projection?.updatedAt ?? null,
    ...(input.checkInFacts ?? []).map((fact) => fact.updatedAt),
    ...(input.statusOverrides ?? []).map((override) => override.updatedAt),
  ])
  const syncState: TeacherAttendanceView['sync']['state'] = input.integration !== 'ready'
    ? 'unavailable'
    : input.pendingSessionCommand || pendingRefs.size > 0
      ? 'pending'
      : (input.occurrence && !projection) || input.projectionKnownStale ? 'stale' : 'current'
  const now = Date.parse(input.now ?? new Date().toISOString())
  const presentThrough = Date.parse(input.occurrence?.presentThroughAt ?? input.occurrence?.opensAt ?? '')
  const absentAt = Date.parse(input.occurrence?.absentAt ?? input.occurrence?.closesAt ?? '')

  return {
    classroomId: input.classroomId, classDate: input.classDate, integration: input.integration,
    session: input.occurrence ? {
      state: projection?.state ?? 'scheduled',
      opensAt: projection?.opensAt ?? input.occurrence.opensAt,
      closesAt: projection?.closesAt ?? input.occurrence.closesAt,
      sessionStartsAt: input.occurrence.sessionStartsAt ?? null,
      sessionEndsAt: input.occurrence.sessionEndsAt ?? null,
      presentThroughAt: input.occurrence.presentThroughAt ?? null,
      absentAt: input.occurrence.absentAt ?? null,
      revision: projection?.revision ?? null,
      pendingCommand: input.pendingSessionCommand ?? false,
      commandFailed: Boolean(input.failedSessionCommand && !input.pendingSessionCommand),
    } : {
      state: 'not_scheduled', opensAt: null, closesAt: null,
      sessionStartsAt: null, sessionEndsAt: null, presentThroughAt: null, absentAt: null,
      revision: null,
      pendingCommand: input.pendingSessionCommand ?? false,
      commandFailed: Boolean(input.failedSessionCommand && !input.pendingSessionCommand),
    },
    sync: { state: syncState, confirmedAt },
    students: input.students.map((student) => {
      const fact = factsByStudent.get(student.studentId)
      const override = overrides.get(student.studentId)
      const automaticStatus: TeacherAttendanceStatus = fact
        ? Date.parse(fact.acceptedAt) <= presentThrough ? 'present' : 'late'
        : Number.isFinite(absentAt) && now >= absentAt ? 'absent' : 'unmarked'
      const hasOverride = Boolean(override?.active && override.status)
      return {
        studentId: student.studentId, firstName: student.firstName, lastName: student.lastName,
        status: hasOverride ? override!.status! : automaticStatus,
        source: hasOverride ? 'staff' : fact ? 'student_qr' : automaticStatus === 'absent' ? 'system' : null,
        revision: hasOverride ? override!.revision : fact?.revision ?? null,
        checkedInAt: fact?.acceptedAt ?? null,
        hasQrCheckIn: Boolean(fact),
        hasManualOverride: hasOverride,
        pendingCommand: fact ? pendingRefs.has(fact.checkInRef) : false,
        commandFailed: failedStudentIds.has(student.studentId)
          && !(fact ? pendingRefs.has(fact.checkInRef) : false),
      }
    }),
  }
}
