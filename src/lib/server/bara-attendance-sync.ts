import { z } from 'zod'

import { getBaraAttendanceIntegrationState } from '@/lib/server/bara-attendance-client'
import { deliverBaraAttendanceMessage } from '@/lib/server/bara-attendance-outbox'
import { buildBaraRosterSnapshot } from '@/lib/server/bara-attendance-roster'
import { buildBaraScheduleSnapshot } from '@/lib/server/bara-attendance-schedule'
import type { VerifiedPikaAttendanceTeacher } from '@/lib/server/bara-attendance-teacher'

const preparationSchema = z.object({
  classroom_id: z.string().uuid(),
  roster_ref: z.string().regex(/^roster_[A-Za-z0-9._~-]+$/),
  title: z.string().min(1).max(200),
  owner_workos_subject: z.string().regex(/^user_[A-Za-z0-9._~-]+$/),
  roster_source_token: z.string().regex(/^[a-f0-9]{32}$/),
  roster_revision: z.number().int().safe().positive(),
  schedule_source_token: z.string().regex(/^[a-f0-9]{32}$/),
  schedule_revision: z.number().int().safe().positive(),
  policy: z.object({
    timezone: z.literal('America/Toronto'),
    opens_local: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    closes_local: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    close_day_offset: z.union([z.literal(0), z.literal(1)]),
    enabled: z.boolean(),
    policy_revision: z.number().int().safe().positive(),
  }).strict(),
  participants: z.array(z.object({
    student_id: z.string().uuid(),
    participant_ref: z.string().regex(/^participant_[A-Za-z0-9._~-]+$/),
    display_name: z.string().min(1).max(200),
    active: z.boolean(),
    workos_subject: z.string().regex(/^user_[A-Za-z0-9._~-]+$/).nullable(),
  }).strict()).max(500),
  class_days: z.array(z.object({
    date: z.string().date(),
    is_class_day: z.boolean(),
    occurrence_ref: z.string().regex(/^occurrence_[A-Za-z0-9._~-]+$/).nullable(),
  }).strict()).max(401),
}).strict()

const stagedSchema = z.object({
  outbox_id: z.string().uuid(),
  idempotency_key: z.string().min(1).max(200),
  revision: z.number().int().safe().positive(),
  status: z.enum(['pending', 'processing', 'delivered', 'non_retryable']),
}).strict()

export class BaraAttendanceSyncError extends Error {
  constructor(readonly code:
    | 'disabled'
    | 'not_configured'
    | 'migration_required'
    | 'identity_not_linked'
    | 'policy_missing'
    | 'source_changed'
    | 'invalid_source'
    | 'sync_failed',
  ) {
    super(code)
    this.name = 'BaraAttendanceSyncError'
  }
}

function mapRpcError(error: { code?: string; message?: string } | null): never {
  if (error?.code === '42883' || error?.code === 'PGRST202') {
    throw new BaraAttendanceSyncError('migration_required')
  }
  if (error?.code === '40001') throw new BaraAttendanceSyncError('source_changed')
  if (error?.message?.includes('identity_not_linked')) {
    throw new BaraAttendanceSyncError('identity_not_linked')
  }
  if (error?.message?.includes('window_policy_missing')) {
    throw new BaraAttendanceSyncError('policy_missing')
  }
  throw new BaraAttendanceSyncError('sync_failed')
}

async function rpc(
  supabase: any,
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) mapRpcError(error)
  return data
}

function refs(rosterRef: string, kind: 'roster' | 'schedule', revision: number) {
  return {
    idempotencyKey: `${kind}:${rosterRef}:revision:${revision}`,
    correlationRef: `${kind}_${rosterRef}_${revision}`,
  }
}

export async function syncTeacherAttendanceSources(input: {
  supabase: any
  teacherId: string
  classroomId: string
  windowStart: string
  windowEnd: string
  verifiedActor?: VerifiedPikaAttendanceTeacher
  integrationState?: 'disabled' | 'not_configured' | 'ready'
}) {
  const integrationState = input.integrationState ?? getBaraAttendanceIntegrationState()
  if (integrationState !== 'ready') throw new BaraAttendanceSyncError(integrationState)
  const installationRef = process.env.BARA_ATTENDANCE_INSTALLATION_REF?.trim() ?? ''
  const tenantRef = process.env.BARA_ATTENDANCE_TENANT_REF?.trim() ?? ''

  const preparedResult = await rpc(input.supabase, 'prepare_attendance_snapshot_v1', {
    p_teacher_id: input.teacherId,
    p_classroom_id: input.classroomId,
    p_window_start: input.windowStart,
    p_window_end: input.windowEnd,
  })
  const prepared = preparationSchema.safeParse(preparedResult)
  if (!prepared.success || prepared.data.classroom_id !== input.classroomId) {
    throw new BaraAttendanceSyncError('invalid_source')
  }
  if (
    input.verifiedActor
    && prepared.data.owner_workos_subject !== input.verifiedActor.workosSubject
  ) {
    throw new BaraAttendanceSyncError('identity_not_linked')
  }

  const rosterRefs = refs(
    prepared.data.roster_ref,
    'roster',
    prepared.data.roster_revision,
  )
  const roster = buildBaraRosterSnapshot({
    installationRef,
    tenantRef,
    rosterRef: prepared.data.roster_ref,
    revision: prepared.data.roster_revision,
    ...rosterRefs,
    ownerWorkosSubject: prepared.data.owner_workos_subject,
    ownerDisplayName: input.verifiedActor?.displayName ?? 'Pika teacher',
    displayName: prepared.data.title,
    participants: prepared.data.participants.map((participant) => ({
      participantRef: participant.participant_ref,
      displayName: participant.display_name,
      active: participant.active,
      ...(participant.workos_subject
        ? { workosSubject: participant.workos_subject }
        : {}),
    })),
  })

  const scheduleRefs = refs(
    prepared.data.roster_ref,
    'schedule',
    prepared.data.schedule_revision,
  )
  const schedule = buildBaraScheduleSnapshot({
    installationRef,
    rosterRef: prepared.data.roster_ref,
    revision: prepared.data.schedule_revision,
    ...scheduleRefs,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    attendanceTitle: `${prepared.data.title} attendance`,
    policy: {
      timezone: prepared.data.policy.timezone,
      opensAtLocal: prepared.data.policy.opens_local,
      closesAtLocal: prepared.data.policy.closes_local,
      closeDayOffset: prepared.data.policy.close_day_offset,
    },
    classDays: prepared.data.class_days.map((classDay) => ({
      date: classDay.date,
      isClassDay: prepared.data.policy.enabled && classDay.is_class_day,
      occurrenceRef: classDay.occurrence_ref ?? 'occurrence_inactive',
    })),
  })

  const stagedRosterResult = await rpc(input.supabase, 'stage_attendance_roster_snapshot_v1', {
    p_teacher_id: input.teacherId,
    p_classroom_id: input.classroomId,
    p_source_token: prepared.data.roster_source_token,
    p_message: roster,
  })
  const stagedScheduleResult = await rpc(
    input.supabase,
    'stage_attendance_schedule_snapshot_v1',
    {
      p_teacher_id: input.teacherId,
      p_classroom_id: input.classroomId,
      p_source_token: prepared.data.schedule_source_token,
      p_message: schedule,
    },
  )
  const stagedRoster = stagedSchema.safeParse(stagedRosterResult)
  const stagedSchedule = stagedSchema.safeParse(stagedScheduleResult)
  if (
    !stagedRoster.success || !stagedSchedule.success ||
    stagedRoster.data.revision !== roster.revision ||
    stagedSchedule.data.revision !== schedule.revision
  ) {
    throw new BaraAttendanceSyncError('invalid_source')
  }

  // Roster delivery precedes schedule delivery. The recovery worker claims by
  // creation order and preserves the same dependency after an outage.
  const rosterResult = await deliverBaraAttendanceMessage({
    supabase: input.supabase,
    classroomId: input.classroomId,
    message: roster,
  })
  const scheduleResult = await deliverBaraAttendanceMessage({
    supabase: input.supabase,
    classroomId: input.classroomId,
    message: schedule,
  })

  return {
    roster: { outcome: rosterResult.outcome, revision: rosterResult.revision },
    schedule: { outcome: scheduleResult.outcome, revision: scheduleResult.revision },
  }
}
