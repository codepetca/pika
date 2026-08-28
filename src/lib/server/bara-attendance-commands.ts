import { z } from 'zod'
import {
  BaraAttendanceClientError,
  type BaraCheckInInvalidationResult,
  type BaraSessionCommandResult,
} from '@/lib/server/bara-attendance-client'
import {
  BaraAttendanceOutboxError,
  deliverBaraAttendanceMessage,
} from '@/lib/server/bara-attendance-outbox'
import type {
  V1CheckInInvalidate,
  V1SessionCommand,
} from '@/vendor/attendance-contract/v1/types'
import type { VerifiedPikaAttendanceTeacher } from '@/lib/server/bara-attendance-teacher'
import { getBaraAttendanceClassroomIntegrationState } from '@/lib/server/bara-attendance-canary'

const opaqueRefSchema = z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/)
const contextRowSchemas = {
  user: z.object({ workos_user_id: opaqueRefSchema.nullable() }).strict().nullable(),
  principal: z.object({ principal_ref: opaqueRefSchema }).strict().nullable(),
  roster: z.object({ roster_ref: opaqueRefSchema }).strict().nullable(),
  occurrence: z.object({
    occurrence_ref: opaqueRefSchema,
    opens_at: z.string().datetime({ offset: true }),
    closes_at: z.string().datetime({ offset: true }),
  }).strict().nullable(),
}
const participantRowsSchema = z.array(z.object({
  student_id: z.string().uuid(),
  participant_ref: opaqueRefSchema,
}).strict())

export interface AttendanceCommandContext {
  installationRef: string
  rosterRef: string
  occurrenceRef: string
  actorPrincipalRef: string
  actorDisplayName: string
}

export interface AttendanceCommandStore {
  loadContext(input: {
    teacherId: string
    classroomId: string
    classDate: string
    actor: VerifiedPikaAttendanceTeacher
  }): Promise<AttendanceCommandContext>
  loadParticipantRefs(input: {
    classroomId: string
    studentIds: string[]
  }): Promise<Map<string, string>>
}

export class TeacherAttendanceCommandError extends Error {
  constructor(readonly code:
    | 'disabled'
    | 'not_configured'
    | 'migration_required'
    | 'identity_not_linked'
    | 'mapping_missing'
    | 'roster_changed'
    | 'conflict'
    | 'upstream_unavailable',
  ) {
    super(code)
    this.name = 'TeacherAttendanceCommandError'
  }
}

function isMigrationError(error: { code?: string } | null) {
  return error?.code === '42P01' || error?.code === 'PGRST205'
}

async function queryMaybeOne(
  supabase: any,
  table: string,
  columns: string,
  filters: Array<[string, string]>,
) {
  let query = supabase.from(table).select(columns)
  for (const [column, value] of filters) query = query.eq(column, value)
  return await query.maybeSingle()
}

export function createSupabaseAttendanceCommandStore(supabase: any): AttendanceCommandStore {
  return {
    async loadContext({ teacherId, classroomId, classDate, actor }) {
      const installationRef = process.env.BARA_ATTENDANCE_INSTALLATION_REF?.trim() ?? ''
      if (!opaqueRefSchema.safeParse(installationRef).success) {
        throw new TeacherAttendanceCommandError('not_configured')
      }
      const [userResult, principalResult, rosterResult, occurrenceResult] = await Promise.all([
        queryMaybeOne(supabase, 'users', 'workos_user_id', [['id', teacherId]]),
        queryMaybeOne(
          supabase,
          'attendance_principal_mappings',
          'principal_ref',
          [['user_id', teacherId]],
        ),
        queryMaybeOne(
          supabase,
          'attendance_roster_mappings',
          'roster_ref',
          [['classroom_id', classroomId]],
        ),
        queryMaybeOne(
          supabase,
          'attendance_occurrence_mappings',
          'occurrence_ref, opens_at, closes_at',
          [['classroom_id', classroomId], ['class_date', classDate]],
        ),
      ])
      for (const result of [userResult, principalResult, rosterResult, occurrenceResult]) {
        if (result.error) {
          throw new TeacherAttendanceCommandError(
            isMigrationError(result.error) ? 'migration_required' : 'upstream_unavailable',
          )
        }
      }
      const user = contextRowSchemas.user.safeParse(userResult.data ?? null)
      const principal = contextRowSchemas.principal.safeParse(principalResult.data ?? null)
      const roster = contextRowSchemas.roster.safeParse(rosterResult.data ?? null)
      const occurrence = contextRowSchemas.occurrence.safeParse(occurrenceResult.data ?? null)
      if (!user.success || !principal.success || !roster.success || !occurrence.success) {
        throw new TeacherAttendanceCommandError('upstream_unavailable')
      }
      if (!user.data?.workos_user_id || user.data.workos_user_id !== actor.workosSubject) {
        throw new TeacherAttendanceCommandError('identity_not_linked')
      }
      if (!principal.data || !roster.data || !occurrence.data) {
        throw new TeacherAttendanceCommandError('mapping_missing')
      }
      return {
        installationRef,
        rosterRef: roster.data.roster_ref,
        occurrenceRef: occurrence.data.occurrence_ref,
        actorPrincipalRef: principal.data.principal_ref,
        actorDisplayName: actor.displayName,
      }
    },

    async loadParticipantRefs({ classroomId, studentIds }) {
      let query = supabase
        .from('attendance_participant_mappings')
        .select('student_id, participant_ref')
        .eq('classroom_id', classroomId)
      query = query.in('student_id', studentIds)
      const { data, error } = await query
      if (error) {
        throw new TeacherAttendanceCommandError(
          isMigrationError(error) ? 'migration_required' : 'upstream_unavailable',
        )
      }
      const parsed = participantRowsSchema.safeParse(data ?? [])
      if (!parsed.success) throw new TeacherAttendanceCommandError('upstream_unavailable')
      const refs = new Map(parsed.data.map((row) => [row.student_id, row.participant_ref]))
      if (refs.size !== studentIds.length || studentIds.some((studentId) => !refs.has(studentId))) {
        throw new TeacherAttendanceCommandError('roster_changed')
      }
      return refs
    },
  }
}

function requestRefs(requestId: string) {
  const compact = requestId.replaceAll('-', '')
  return {
    correlationRef: `correlation_${compact}`,
    compact,
  }
}

function mapClientError(
  error: unknown,
  options: { durableClientFailure: boolean },
): { outcome: 'pending' } {
  if (error instanceof BaraAttendanceOutboxError) {
    if (error.code === 'migration_required') {
      throw new TeacherAttendanceCommandError('migration_required')
    }
    if (error.code === 'idempotency_conflict') {
      throw new TeacherAttendanceCommandError('conflict')
    }
    if (
      error.retryable
      && (error.code === 'delivery_pending' || error.code === 'lease_lost')
    ) return { outcome: 'pending' }
    throw new TeacherAttendanceCommandError('upstream_unavailable')
  }
  if (error instanceof BaraAttendanceClientError) {
    if (error.code === 'disabled') throw new TeacherAttendanceCommandError('disabled')
    if (error.code === 'configuration') throw new TeacherAttendanceCommandError('not_configured')
    if (error.status === 409 || error.code === 'stale_revision') {
      throw new TeacherAttendanceCommandError('conflict')
    }
    if (options.durableClientFailure && error.retryable) return { outcome: 'pending' }
    throw new TeacherAttendanceCommandError('upstream_unavailable')
  }
  throw error
}

export async function executeTeacherAttendanceSessionCommand(input: {
  supabase: any
  teacherId: string
  classroomId: string
  classDate: string
  requestId: string
  command: 'open' | 'close'
  actor: VerifiedPikaAttendanceTeacher
  integrationState?: 'disabled' | 'not_configured' | 'ready'
  store?: AttendanceCommandStore
  send?: (payload: V1SessionCommand) => Promise<BaraSessionCommandResult>
}) {
  const integrationState = input.integrationState ?? getBaraAttendanceClassroomIntegrationState({
    teacherId: input.teacherId,
    classroomId: input.classroomId,
  })
  if (integrationState !== 'ready') {
    throw new TeacherAttendanceCommandError(integrationState)
  }
  const store = input.store ?? createSupabaseAttendanceCommandStore(input.supabase)
  const context = await store.loadContext(input)
  const refs = requestRefs(input.requestId)
  const payload: V1SessionCommand = {
    schema_version: 1,
    message_type: 'session.command',
    idempotency_key: `session:${context.occurrenceRef}:${refs.compact}`,
    correlation_ref: refs.correlationRef,
    installation_ref: context.installationRef,
    roster_ref: context.rosterRef,
    occurrence_ref: context.occurrenceRef,
    command: input.command,
    actor_principal_ref: context.actorPrincipalRef,
    actor_display_name: context.actorDisplayName,
  }
  try {
    const result = await (input.send
      ? input.send(payload)
      : deliverBaraAttendanceMessage({
          supabase: input.supabase,
          teacherId: input.teacherId,
          classroomId: input.classroomId,
          message: payload,
        }))
    return { outcome: result.outcome, state: result.status, revision: result.sessionRevision }
  } catch (error) {
    return mapClientError(error, { durableClientFailure: !input.send })
  }
}

export async function executeTeacherAttendanceMarks(input: {
  supabase: any
  teacherId: string
  classroomId: string
  classDate: string
  requestId: string
  actor?: VerifiedPikaAttendanceTeacher
  marks: Array<{
    studentId: string
    status: 'automatic' | 'present' | 'late' | 'absent'
    reasonCode?: string
  }>
  integrationState?: 'disabled' | 'not_configured' | 'ready'
}) {
  const integrationState = input.integrationState ?? getBaraAttendanceClassroomIntegrationState({
    teacherId: input.teacherId,
    classroomId: input.classroomId,
  })
  if (integrationState !== 'ready') {
    throw new TeacherAttendanceCommandError(integrationState)
  }
  const { data, error } = await input.supabase.rpc('apply_attendance_status_overrides_v1', {
    p_teacher_id: input.teacherId,
    p_classroom_id: input.classroomId,
    p_class_date: input.classDate,
    p_request_id: input.requestId,
    p_marks: input.marks.map((mark) => ({
      student_id: mark.studentId,
      status: mark.status,
      ...(mark.reasonCode ? { reason_code: mark.reasonCode } : {}),
    })),
  })
  if (error) {
    if (isMigrationError(error)) throw new TeacherAttendanceCommandError('migration_required')
    if (error.code === '23505') throw new TeacherAttendanceCommandError('conflict')
    if (error.message?.includes('attendance_roster_changed')) {
      throw new TeacherAttendanceCommandError('roster_changed')
    }
    throw new TeacherAttendanceCommandError('upstream_unavailable')
  }
  const parsed = z.object({
    outcome: z.enum(['applied', 'duplicate']),
    occurrence_ref: opaqueRefSchema,
    applied_count: z.number().int().nonnegative(),
    unchanged_count: z.number().int().nonnegative(),
  }).strict().safeParse(data)
  if (!parsed.success) throw new TeacherAttendanceCommandError('upstream_unavailable')
  return {
    outcome: parsed.data.outcome,
    appliedCount: parsed.data.applied_count,
    unchangedCount: parsed.data.unchanged_count,
  }
}

export async function executeTeacherCheckInInvalidations(input: {
  supabase: any
  teacherId: string
  classroomId: string
  classDate: string
  requestId: string
  actor: VerifiedPikaAttendanceTeacher
  studentIds: string[]
  integrationState?: 'disabled' | 'not_configured' | 'ready'
  store?: AttendanceCommandStore
  send?: (payload: V1CheckInInvalidate) => Promise<BaraCheckInInvalidationResult>
}) {
  const integrationState = input.integrationState ?? getBaraAttendanceClassroomIntegrationState({
    teacherId: input.teacherId,
    classroomId: input.classroomId,
  })
  if (integrationState !== 'ready') throw new TeacherAttendanceCommandError(integrationState)
  const store = input.store ?? createSupabaseAttendanceCommandStore(input.supabase)
  const context = await store.loadContext(input)
  const { data, error } = await input.supabase
    .from('attendance_check_in_facts')
    .select('student_id, check_in_ref, accepted_at')
    .eq('classroom_id', input.classroomId)
    .eq('occurrence_ref', context.occurrenceRef)
    .is('invalidated_at', null)
    .in('student_id', input.studentIds)
    .order('accepted_at', { ascending: false })
  if (error) {
    throw new TeacherAttendanceCommandError(
      isMigrationError(error) ? 'migration_required' : 'upstream_unavailable',
    )
  }
  const parsed = z.array(z.object({
    student_id: z.string().uuid(), check_in_ref: opaqueRefSchema,
    accepted_at: z.string().datetime({ offset: true }),
  }).strict()).safeParse(data ?? [])
  if (!parsed.success) throw new TeacherAttendanceCommandError('upstream_unavailable')
  const latestByStudent = new Map<string, { checkInRef: string; acceptedAt: string }>()
  for (const row of parsed.data) {
    const current = latestByStudent.get(row.student_id)
    if (!current || Date.parse(row.accepted_at) > Date.parse(current.acceptedAt)) {
      latestByStudent.set(row.student_id, {
        checkInRef: row.check_in_ref,
        acceptedAt: row.accepted_at,
      })
    }
  }
  if (latestByStudent.size === 0) {
    return { outcome: 'applied' as const, appliedCount: 0, unchangedCount: 0 }
  }
  const refs = requestRefs(input.requestId)
  const payload: V1CheckInInvalidate = {
    schema_version: 1,
    message_type: 'check_in.invalidate',
    idempotency_key: `invalidate:${context.occurrenceRef}:${refs.compact}`,
    correlation_ref: refs.correlationRef,
    installation_ref: context.installationRef,
    roster_ref: context.rosterRef,
    occurrence_ref: context.occurrenceRef,
    actor_principal_ref: context.actorPrincipalRef,
    actor_display_name: context.actorDisplayName,
    invalidations: [...latestByStudent.values()].map(({ checkInRef }, index) => ({
      command_ref: `invalidate_${refs.compact}_${index + 1}`,
      check_in_ref: checkInRef,
      reason_code: 'staff_reset',
    })),
  }
  try {
    const result = await (input.send
      ? input.send(payload)
      : deliverBaraAttendanceMessage({
          supabase: input.supabase,
          teacherId: input.teacherId,
          classroomId: input.classroomId,
          message: payload,
        }))
    return {
      outcome: result.outcome,
      appliedCount: result.appliedCount,
      unchangedCount: result.unchangedCount,
    }
  } catch (reason) {
    return mapClientError(reason, { durableClientFailure: !input.send })
  }
}
