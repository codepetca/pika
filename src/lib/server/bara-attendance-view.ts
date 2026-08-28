import { z } from 'zod'
import { loadAttendanceRoster } from '@/lib/server/attendance-report'
import type {
  TeacherAttendanceSessionState,
  TeacherAttendanceSource,
  TeacherAttendanceStatus,
  TeacherAttendanceView,
} from '@/lib/teacher-attendance'
import { validateV1Event, validateV1Message } from '@/vendor/attendance-contract/v1/validate'

export type {
  TeacherAttendanceSessionState,
  TeacherAttendanceSource,
  TeacherAttendanceStatus,
  TeacherAttendanceView,
} from '@/lib/teacher-attendance'

interface StudentInput {
  studentId: string
  firstName: string
  lastName: string
}

interface ParticipantMappingInput {
  studentId: string
  participantRef: string
}

interface OccurrenceInput {
  occurrenceRef: string
  opensAt: string
  closesAt: string
}

interface SessionProjectionInput extends OccurrenceInput {
  state: Exclude<TeacherAttendanceSessionState, 'not_scheduled'>
  revision: number
  updatedAt: string
}

interface RecordProjectionInput {
  participantRef: string
  status: TeacherAttendanceStatus
  source: 'student_qr' | 'staff_manual' | 'system_finalize'
  revision: number
  updatedAt: string
}

interface QrCheckInInput {
  participantRef: string
  status: TeacherAttendanceStatus
  recordedAt: string
}

export interface BuildTeacherAttendanceViewInput {
  classroomId: string
  classDate: string
  integration: TeacherAttendanceView['integration']
  students: StudentInput[]
  participantMappings: ParticipantMappingInput[]
  occurrence: OccurrenceInput | null
  sessionProjection: SessionProjectionInput | null
  recordProjections: RecordProjectionInput[]
  qrCheckIns?: QrCheckInInput[]
  pendingStudentIds: string[]
  pendingSessionCommand?: boolean
  failedStudentIds?: string[]
  failedSessionCommand?: boolean
  projectionKnownStale?: boolean
}

type QueryResult = Promise<{ data: unknown; error: { code?: string; message?: string } | null }>

const opaqueRefSchema = z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/)
const positiveRevisionSchema = z.number().int().safe().positive()
const instantSchema = z.string().datetime({ offset: true })

const participantMappingRowsSchema = z.array(z.object({
  student_id: z.string().uuid(),
  participant_ref: opaqueRefSchema,
}).strict())

const occurrenceRowSchema = z.object({
  occurrence_ref: opaqueRefSchema,
  opens_at: instantSchema.nullable(),
  closes_at: instantSchema.nullable(),
}).strict().nullable()

const policyRowSchema = z.object({ enabled: z.boolean() }).strict().nullable()

const sessionProjectionRowSchema = z.object({
  occurrence_ref: opaqueRefSchema,
  status: z.enum(['scheduled', 'open', 'closed', 'cancelled']),
  opens_at: instantSchema.nullable(),
  closes_at: instantSchema.nullable(),
  session_revision: positiveRevisionSchema,
  updated_at: instantSchema,
}).strict().nullable()

const recordProjectionRowsSchema = z.array(z.object({
  participant_ref: opaqueRefSchema,
  status: z.enum(['unmarked', 'present', 'late', 'absent']),
  source: z.enum(['student_qr', 'staff_manual', 'system_finalize']),
  record_revision: positiveRevisionSchema,
  updated_at: instantSchema,
}).strict())

const integrationInboxRowsSchema = z.array(z.object({
  payload: z.unknown(),
}).strict())

const unresolvedOutboxRowsSchema = z.array(z.object({
  message_type: z.enum(['roster.snapshot', 'schedule.snapshot', 'session.command', 'attendance.marks']),
  payload: z.unknown(),
  status: z.enum(['pending', 'processing', 'non_retryable']),
  lease_expires_at: instantSchema.nullable(),
  updated_at: instantSchema,
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

async function selectMany(
  client: any,
  table: string,
  columns: string,
  filters: Array<[string, string]>,
): QueryResult {
  let query: any = client.from(table).select(columns)
  for (const [column, value] of filters) query = query.eq(column, value)
  return await query
}

async function selectMaybeOne(
  client: any,
  table: string,
  columns: string,
  filters: Array<[string, string]>,
): QueryResult {
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
  if (roster.enrollmentsError || roster.profilesError) {
    throw new TeacherAttendanceViewReadError('read_failed')
  }
  const students = roster.students.map((student) => ({
    studentId: student.id,
    firstName: student.first_name,
    lastName: student.last_name,
  }))

  if (input.integration !== 'ready') {
    return buildTeacherAttendanceView({
      classroomId: input.classroomId,
      classDate: input.classDate,
      integration: input.integration,
      students,
      participantMappings: [],
      occurrence: null,
      sessionProjection: null,
      recordProjections: [],
      pendingStudentIds: [],
    })
  }

  const installationRef = input.installationRef ?? process.env.BARA_ATTENDANCE_INSTALLATION_REF?.trim()
  if (!installationRef || !opaqueRefSchema.safeParse(installationRef).success) {
    throw new TeacherAttendanceViewReadError('read_failed')
  }

  const [participantResult, occurrenceResult, policyResult] = await Promise.all([
    selectMany(
      input.supabase,
      'attendance_participant_mappings',
      'student_id, participant_ref',
      [['classroom_id', input.classroomId]],
    ),
    selectMaybeOne(
      input.supabase,
      'attendance_occurrence_mappings',
      'occurrence_ref, opens_at, closes_at',
      [['classroom_id', input.classroomId], ['class_date', input.classDate]],
    ),
    selectMaybeOne(
      input.supabase,
      'attendance_window_policies',
      'enabled',
      [['classroom_id', input.classroomId]],
    ),
  ])
  if (participantResult.error) readError(participantResult.error)
  if (occurrenceResult.error) readError(occurrenceResult.error)
  if (policyResult.error) readError(policyResult.error)

  const participantParsed = participantMappingRowsSchema.safeParse(participantResult.data ?? [])
  const occurrenceParsed = occurrenceRowSchema.safeParse(occurrenceResult.data ?? null)
  const policyParsed = policyRowSchema.safeParse(policyResult.data ?? null)
  if (!participantParsed.success || !occurrenceParsed.success || !policyParsed.success) {
    throw new TeacherAttendanceViewReadError('invalid_projection')
  }

  const occurrence = occurrenceParsed.data
  if (!occurrence || !occurrence.opens_at || !occurrence.closes_at) {
    return buildTeacherAttendanceView({
      classroomId: input.classroomId,
      classDate: input.classDate,
      integration: policyParsed.data?.enabled ? 'ready' : 'not_configured',
      students,
      participantMappings: participantParsed.data.map((row) => ({
        studentId: row.student_id,
        participantRef: row.participant_ref,
      })),
      occurrence: null,
      sessionProjection: null,
      recordProjections: [],
      pendingStudentIds: [],
    })
  }

  const [sessionResult, recordResult, inboxResult, outboxResult] = await Promise.all([
    selectMaybeOne(
      input.supabase,
      'attendance_session_projection',
      'occurrence_ref, status, opens_at, closes_at, session_revision, updated_at',
      [['installation_ref', installationRef], ['occurrence_ref', occurrence.occurrence_ref]],
    ),
    selectMany(
      input.supabase,
      'attendance_record_projection',
      'participant_ref, status, source, record_revision, updated_at',
      [['installation_ref', installationRef], ['occurrence_ref', occurrence.occurrence_ref]],
    ),
    selectMany(
      input.supabase,
      'attendance_integration_inbox',
      'payload',
      [
        ['classroom_id', input.classroomId],
        ['installation_ref', installationRef],
        ['occurrence_ref', occurrence.occurrence_ref],
        ['event_type', 'attendance.record.changed'],
      ],
    ),
    input.supabase
      .from('attendance_integration_outbox')
      .select('message_type, payload, status, lease_expires_at, updated_at')
      .eq('classroom_id', input.classroomId)
      .in('status', ['pending', 'processing', 'non_retryable']),
  ])
  if (sessionResult.error) readError(sessionResult.error)
  if (recordResult.error) readError(recordResult.error)
  if (inboxResult.error) readError(inboxResult.error)
  if (outboxResult.error) readError(outboxResult.error)

  const sessionParsed = sessionProjectionRowSchema.safeParse(sessionResult.data ?? null)
  const recordsParsed = recordProjectionRowsSchema.safeParse(recordResult.data ?? [])
  const inboxParsed = integrationInboxRowsSchema.safeParse(inboxResult.data ?? [])
  const outboxParsed = unresolvedOutboxRowsSchema.safeParse(outboxResult.data ?? [])
  if (!sessionParsed.success || !recordsParsed.success || !inboxParsed.success || !outboxParsed.success) {
    throw new TeacherAttendanceViewReadError('invalid_projection')
  }

  const qrCheckInByParticipantRef = new Map<string, QrCheckInInput>()
  for (const row of inboxParsed.data) {
    const validation = validateV1Event(row.payload)
    if (!validation.ok) throw new TeacherAttendanceViewReadError('invalid_projection')
    const event = validation.value
    if (
      event.event_type !== 'attendance.record.changed'
      || event.installation_ref !== installationRef
      || event.occurrence_ref !== occurrence.occurrence_ref
      || event.metadata.source !== 'student_qr'
    ) {
      continue
    }
    const existing = qrCheckInByParticipantRef.get(event.metadata.participant_ref)
    if (!existing || Date.parse(event.occurred_at) < Date.parse(existing.recordedAt)) {
      qrCheckInByParticipantRef.set(event.metadata.participant_ref, {
        participantRef: event.metadata.participant_ref,
        status: event.metadata.to_status,
        recordedAt: event.occurred_at,
      })
    }
  }

  const studentIdByParticipantRef = new Map(
    participantParsed.data.map((row) => [row.participant_ref, row.student_id]),
  )
  const pendingStudentIds = new Set<string>()
  const failedStudentIds = new Set<string>()
  let pendingSessionCommand = false
  let failedSessionCommand = false
  const recordByParticipantRef = new Map(
    recordsParsed.data.map((record) => [record.participant_ref, record]),
  )
  const isPending = (row: z.infer<typeof unresolvedOutboxRowsSchema>[number]) =>
    row.status === 'pending'
      || (
        row.status === 'processing'
        && row.lease_expires_at !== null
        && Date.parse(row.lease_expires_at) > Date.now()
      )
  for (const row of outboxParsed.data) {
    const validation = validateV1Message(row.payload)
    if (!validation.ok || validation.value.message_type !== row.message_type) {
      throw new TeacherAttendanceViewReadError('invalid_projection')
    }
    const message = validation.value
    if (!('occurrence_ref' in message) || message.occurrence_ref !== occurrence.occurrence_ref) {
      continue
    }
    if (message.message_type === 'session.command') {
      if (isPending(row)) {
        pendingSessionCommand = true
      } else if (
        row.status === 'non_retryable'
        && (
          !sessionParsed.data
          || Date.parse(row.updated_at) > Date.parse(sessionParsed.data.updated_at)
        )
      ) {
        failedSessionCommand = true
      }
    }
    if (message.message_type === 'attendance.marks') {
      for (const mark of message.marks) {
        const studentId = studentIdByParticipantRef.get(mark.participant_ref)
        if (!studentId) continue
        if (isPending(row)) {
          pendingStudentIds.add(studentId)
        } else if (row.status === 'non_retryable') {
          const projection = recordByParticipantRef.get(mark.participant_ref)
          if (!projection || Date.parse(row.updated_at) > Date.parse(projection.updated_at)) {
            failedStudentIds.add(studentId)
          }
        }
      }
    }
  }
  if (pendingSessionCommand) failedSessionCommand = false
  for (const studentId of pendingStudentIds) failedStudentIds.delete(studentId)

  return buildTeacherAttendanceView({
    classroomId: input.classroomId,
    classDate: input.classDate,
    integration: 'ready',
    students,
    participantMappings: participantParsed.data.map((row) => ({
      studentId: row.student_id,
      participantRef: row.participant_ref,
    })),
    occurrence: {
      occurrenceRef: occurrence.occurrence_ref,
      opensAt: occurrence.opens_at,
      closesAt: occurrence.closes_at,
    },
    sessionProjection: sessionParsed.data
      ? {
          occurrenceRef: sessionParsed.data.occurrence_ref,
          state: sessionParsed.data.status,
          opensAt: sessionParsed.data.opens_at ?? occurrence.opens_at,
          closesAt: sessionParsed.data.closes_at ?? occurrence.closes_at,
          revision: sessionParsed.data.session_revision,
          updatedAt: sessionParsed.data.updated_at,
        }
      : null,
    recordProjections: recordsParsed.data.map((row) => ({
      participantRef: row.participant_ref,
      status: row.status,
      source: row.source,
      revision: row.record_revision,
      updatedAt: row.updated_at,
    })),
    qrCheckIns: [...qrCheckInByParticipantRef.values()],
    pendingStudentIds: [...pendingStudentIds],
    pendingSessionCommand,
    failedStudentIds: [...failedStudentIds],
    failedSessionCommand,
  })
}

function normalizeSource(source: RecordProjectionInput['source']): TeacherAttendanceSource {
  if (source === 'staff_manual') return 'staff'
  if (source === 'system_finalize') return 'system'
  return 'student_qr'
}

function latestInstant(values: Array<string | null>): string | null {
  let latest: string | null = null
  let latestTime = Number.NEGATIVE_INFINITY
  for (const value of values) {
    if (!value) continue
    const time = Date.parse(value)
    if (Number.isFinite(time) && time > latestTime) {
      latest = value
      latestTime = time
    }
  }
  return latest
}

export function buildTeacherAttendanceView(
  input: BuildTeacherAttendanceViewInput,
): TeacherAttendanceView {
  const pendingStudentIds = new Set(input.pendingStudentIds)
  const failedStudentIds = new Set(input.failedStudentIds ?? [])
  const participantRefByStudentId = new Map(
    input.participantMappings.map((mapping) => [mapping.studentId, mapping.participantRef]),
  )
  const recordByParticipantRef = new Map(
    input.recordProjections.map((record) => [record.participantRef, record]),
  )
  const currentQrCheckIns = input.recordProjections
      .filter((record) => record.source === 'student_qr')
      .map((record) => ({
        participantRef: record.participantRef,
        status: record.status,
        recordedAt: record.updatedAt,
      }))
  const qrCheckInByParticipantRef = new Map<string, QrCheckInInput>(
    [...currentQrCheckIns, ...(input.qrCheckIns ?? [])]
      .map((checkIn): [string, QrCheckInInput] => [checkIn.participantRef, checkIn]),
  )

  const projectionMatchesOccurrence = Boolean(
    input.occurrence &&
      input.sessionProjection?.occurrenceRef === input.occurrence.occurrenceRef,
  )
  const projection = projectionMatchesOccurrence ? input.sessionProjection : null
  const confirmedAt = latestInstant([
    projection?.updatedAt ?? null,
    ...input.recordProjections.map((record) => record.updatedAt),
  ])

  let syncState: TeacherAttendanceView['sync']['state']
  if (input.integration !== 'ready') {
    syncState = 'unavailable'
  } else if (pendingStudentIds.size > 0 || input.pendingSessionCommand) {
    syncState = 'pending'
  } else if ((input.occurrence && !projection) || input.projectionKnownStale) {
    syncState = 'stale'
  } else {
    syncState = 'current'
  }

  return {
    classroomId: input.classroomId,
    classDate: input.classDate,
    integration: input.integration,
    session: projection
      ? {
          state: projection.state,
          opensAt: projection.opensAt,
          closesAt: projection.closesAt,
          revision: projection.revision,
          commandFailed: input.failedSessionCommand ?? false,
        }
      : input.occurrence
        ? {
            state: 'scheduled',
            opensAt: input.occurrence.opensAt,
            closesAt: input.occurrence.closesAt,
            revision: null,
            commandFailed: input.failedSessionCommand ?? false,
          }
        : {
            state: 'not_scheduled',
            opensAt: null,
            closesAt: null,
            revision: null,
            commandFailed: input.failedSessionCommand ?? false,
          },
    sync: { state: syncState, confirmedAt },
    students: input.students.map((student) => {
      const participantRef = participantRefByStudentId.get(student.studentId)
      const record = participantRef ? recordByParticipantRef.get(participantRef) : undefined
      const qrCheckIn = participantRef ? qrCheckInByParticipantRef.get(participantRef) : undefined
      return {
        studentId: student.studentId,
        firstName: student.firstName,
        lastName: student.lastName,
        status: record?.status ?? 'unmarked',
        source: record ? normalizeSource(record.source) : null,
        checkedInAt: qrCheckIn?.recordedAt ?? null,
        checkedInStatus: qrCheckIn?.status ?? null,
        revision: record?.revision ?? null,
        pendingCommand: pendingStudentIds.has(student.studentId),
        commandFailed: failedStudentIds.has(student.studentId),
      }
    }),
  }
}
