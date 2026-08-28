import { z } from 'zod'

import { deliverBaraAttendanceMessage } from '@/lib/server/bara-attendance-outbox'
import { buildBaraRosterSnapshot } from '@/lib/server/bara-attendance-roster'
import {
  buildBaraScheduleSnapshot,
  materializeBaraAttendanceSchedule,
  type BaraAttendanceCutoffSnapshot,
} from '@/lib/server/bara-attendance-schedule'
import type { VerifiedPikaAttendanceTeacher } from '@/lib/server/bara-attendance-teacher'
import { getBaraAttendanceClassroomIntegrationState } from '@/lib/server/bara-attendance-canary'
import { getBaraAttendanceScopeMode } from '@/lib/server/bara-attendance-scope'

const preparationSchema = z.object({
  integration_mode: z.literal('active').optional(),
  classroom_id: z.string().uuid(),
  roster_ref: z.string().regex(/^roster_[A-Za-z0-9._~-]+$/),
  title: z.string().min(1).max(200),
  owner_principal_ref: z.string().regex(/^principal_[A-Za-z0-9._~-]+$/),
  roster_source_token: z.string().regex(/^[a-f0-9]{32}$/),
  roster_revision: z.number().int().safe().positive(),
  schedule_source_token: z.string().regex(/^[a-f0-9]{32}$/),
  schedule_revision: z.number().int().safe().positive(),
  policy: z.object({
    timezone: z.literal('America/Toronto'),
    session_starts_local: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    session_ends_local: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    session_end_day_offset: z.union([z.literal(0), z.literal(1)]),
    entry_opens_minutes_before: z.number().int().min(0).max(720),
    present_grace_minutes: z.number().int().min(0).max(720),
    entry_closes_minutes_before_end: z.number().int().min(0).max(720),
    absent_minutes_before_end: z.number().int().min(0).max(720),
    enabled: z.boolean(),
    policy_revision: z.number().int().safe().positive(),
  }).strict(),
  participants: z.array(z.object({
    student_id: z.string().uuid(),
    participant_ref: z.string().regex(/^participant_[A-Za-z0-9._~-]+$/),
    display_name: z.string().min(1).max(200),
    active: z.boolean(),
    principal_ref: z.string().regex(/^principal_[A-Za-z0-9._~-]+$/).nullable(),
  }).strict()).max(500),
  class_days: z.array(z.object({
    date: z.string().date(),
    is_class_day: z.boolean(),
    occurrence_ref: z.string().regex(/^occurrence_[A-Za-z0-9._~-]+$/).nullable(),
  }).strict()).max(401),
}).strict()

const deactivationPreparationSchema = z.object({
  integration_mode: z.literal('deactivating'),
  classroom_id: z.string().uuid(),
  roster_ref: z.string().regex(/^roster_[A-Za-z0-9._~-]+$/),
  title: z.string().min(1).max(200),
  schedule_source_token: z.string().regex(/^[a-f0-9]{32}$/),
  schedule_revision: z.number().int().safe().positive(),
  window_start: z.string().date(),
  window_end: z.string().date(),
  policy: z.object({
    timezone: z.literal('America/Toronto'),
    opens_local: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    closes_local: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    close_day_offset: z.union([z.literal(0), z.literal(1)]),
    enabled: z.literal(false),
    policy_revision: z.number().int().safe().positive(),
  }).strict(),
  class_days: z.tuple([]),
}).strict()

const inactivePreparationSchema = z.object({
  integration_mode: z.literal('inactive'),
  classroom_id: z.string().uuid(),
  roster_ref: z.string().regex(/^roster_[A-Za-z0-9._~-]+$/),
  title: z.string().min(1).max(200),
}).strict()

const stagedSchema = z.object({
  outbox_id: z.string().uuid(),
  idempotency_key: z.string().min(1).max(200),
  revision: z.number().int().safe().positive(),
  status: z.enum(['pending', 'processing', 'delivered', 'non_retryable']),
}).strict()

const occurrenceCutoffRowSchema = z.object({
  occurrence_ref: z.string(),
  class_date: z.string().date(),
  opens_at: z.string().datetime({ offset: true }).nullable(),
  closes_at: z.string().datetime({ offset: true }).nullable(),
  session_starts_at: z.string().datetime({ offset: true }).nullable(),
  session_ends_at: z.string().datetime({ offset: true }).nullable(),
  present_through_at: z.string().datetime({ offset: true }).nullable(),
  absent_at: z.string().datetime({ offset: true }).nullable(),
  policy_revision: z.number().int().safe().positive().nullable(),
  policy_frozen_at: z.string().datetime({ offset: true }).nullable(),
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
  scheduleThrough?: string | null
  scopeMode?: 'exact_canary' | 'teacher_entitlements'
}) {
  const integrationState = input.integrationState ?? getBaraAttendanceClassroomIntegrationState({
    teacherId: input.teacherId,
    classroomId: input.classroomId,
  })
  if (integrationState !== 'ready') throw new BaraAttendanceSyncError(integrationState)
  const installationRef = process.env.BARA_ATTENDANCE_INSTALLATION_REF?.trim() ?? ''
  const tenantRef = process.env.BARA_ATTENDANCE_TENANT_REF?.trim() ?? ''
  const scopeMode = input.scopeMode ?? getBaraAttendanceScopeMode()
  const windowEnd = input.scheduleThrough && input.scheduleThrough < input.windowEnd
    ? input.scheduleThrough
    : input.windowEnd
  if (windowEnd < input.windowStart) throw new BaraAttendanceSyncError('disabled')

  const preparedResult = await rpc(input.supabase,
    scopeMode === 'teacher_entitlements'
      ? 'prepare_attendance_snapshot_v2'
      : 'prepare_attendance_snapshot_v1', {
    p_teacher_id: input.teacherId,
    p_classroom_id: input.classroomId,
    p_window_start: input.windowStart,
    p_window_end: windowEnd,
    ...(scopeMode === 'teacher_entitlements'
      ? { p_at: new Date().toISOString() }
      : {}),
  })
  const inactive = inactivePreparationSchema.safeParse(preparedResult)
  if (inactive.success) {
    return {
      roster: { outcome: 'not_required' as const, revision: 0 },
      schedule: { outcome: 'not_required' as const, revision: 0 },
    }
  }
  const deactivation = deactivationPreparationSchema.safeParse(preparedResult)
  if (deactivation.success) {
    const scheduleRefs = refs(
      deactivation.data.roster_ref,
      'schedule',
      deactivation.data.schedule_revision,
    )
    const schedule = buildBaraScheduleSnapshot({
      installationRef,
      rosterRef: deactivation.data.roster_ref,
      revision: deactivation.data.schedule_revision,
      ...scheduleRefs,
      windowStart: deactivation.data.window_start,
      windowEnd: deactivation.data.window_end,
      attendanceTitle: `${deactivation.data.title} attendance`,
      policy: {
        timezone: deactivation.data.policy.timezone,
        sessionStartsAtLocal: deactivation.data.policy.opens_local,
        sessionEndsAtLocal: deactivation.data.policy.closes_local,
        sessionEndDayOffset: deactivation.data.policy.close_day_offset,
        entryOpensMinutesBefore: 0,
        presentGraceMinutes: 0,
        entryClosesMinutesBeforeEnd: 0,
        absentMinutesBeforeEnd: 0,
        policyRevision: deactivation.data.policy.policy_revision,
      },
      classDays: [],
    })
    const stagedResult = await rpc(
      input.supabase,
      'stage_attendance_schedule_snapshot_v2',
      {
        p_teacher_id: input.teacherId,
        p_classroom_id: input.classroomId,
        p_source_token: deactivation.data.schedule_source_token,
        p_message: schedule,
        p_at: new Date().toISOString(),
      },
    )
    const staged = stagedSchema.safeParse(stagedResult)
    if (!staged.success || staged.data.revision !== schedule.revision) {
      throw new BaraAttendanceSyncError('invalid_source')
    }
    const result = await deliverBaraAttendanceMessage({
      supabase: input.supabase,
      teacherId: input.teacherId,
      classroomId: input.classroomId,
      message: schedule,
      scopeMode,
    })
    return {
      roster: { outcome: 'not_required' as const, revision: 0 },
      schedule: { outcome: result.outcome, revision: result.revision },
    }
  }
  const prepared = preparationSchema.safeParse(preparedResult)
  if (!prepared.success || prepared.data.classroom_id !== input.classroomId) {
    throw new BaraAttendanceSyncError('invalid_source')
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
    ownerPrincipalRef: prepared.data.owner_principal_ref,
    // Snapshot retries must be byte-identical for a source revision. The
    // verified WorkOS actor is request context, not persisted roster source
    // data, so it cannot safely influence the durable contract payload.
    ownerDisplayName: 'Pika teacher',
    displayName: prepared.data.title,
    participants: prepared.data.participants.map((participant) => ({
      participantRef: participant.participant_ref,
      displayName: participant.display_name,
      active: participant.active,
      ...(participant.principal_ref
        ? { principalRef: participant.principal_ref }
        : {}),
    })),
  })

  const scheduleRefs = refs(
    prepared.data.roster_ref,
    'schedule',
    prepared.data.schedule_revision,
  )
  const now = new Date()
  const { data: cutoffRows, error: cutoffError } = await input.supabase
    .from('attendance_occurrence_mappings')
    .select('occurrence_ref, class_date, opens_at, closes_at, session_starts_at, session_ends_at, present_through_at, absent_at, policy_revision, policy_frozen_at')
    .eq('classroom_id', input.classroomId)
    .gte('class_date', input.windowStart)
    .lte('class_date', windowEnd)
  if (cutoffError) mapRpcError(cutoffError)
  const parsedCutoffRows = z.array(occurrenceCutoffRowSchema).safeParse(cutoffRows ?? [])
  if (!parsedCutoffRows.success) throw new BaraAttendanceSyncError('invalid_source')
  const cutoffsByRef = new Map<string, BaraAttendanceCutoffSnapshot>()
  for (const row of parsedCutoffRows.data) {
    if (row.opens_at !== null && row.closes_at !== null
      && row.session_starts_at !== null && row.session_ends_at !== null
      && row.present_through_at !== null && row.absent_at !== null
      && row.policy_revision !== null
      && (row.policy_frozen_at !== null || Date.parse(row.opens_at) <= now.getTime())) {
      cutoffsByRef.set(row.occurrence_ref, {
        occurrence_ref: row.occurrence_ref,
        date: row.class_date,
        accepts_at: row.opens_at,
        stops_accepting_at: row.closes_at,
        session_starts_at: row.session_starts_at,
        session_ends_at: row.session_ends_at,
        present_through_at: row.present_through_at,
        absent_at: row.absent_at,
        policy_revision: row.policy_revision,
      })
    }
  }
  const materializedSchedule = materializeBaraAttendanceSchedule({
    installationRef,
    rosterRef: prepared.data.roster_ref,
    revision: prepared.data.schedule_revision,
    ...scheduleRefs,
    windowStart: input.windowStart,
    windowEnd,
    attendanceTitle: `${prepared.data.title} attendance`,
    policy: {
      timezone: prepared.data.policy.timezone,
      sessionStartsAtLocal: prepared.data.policy.session_starts_local,
      sessionEndsAtLocal: prepared.data.policy.session_ends_local,
      sessionEndDayOffset: prepared.data.policy.session_end_day_offset,
      entryOpensMinutesBefore: prepared.data.policy.entry_opens_minutes_before,
      presentGraceMinutes: prepared.data.policy.present_grace_minutes,
      entryClosesMinutesBeforeEnd: prepared.data.policy.entry_closes_minutes_before_end,
      absentMinutesBeforeEnd: prepared.data.policy.absent_minutes_before_end,
      policyRevision: prepared.data.policy.policy_revision,
    },
    classDays: prepared.data.class_days.map((classDay) => ({
      date: classDay.date,
      isClassDay: prepared.data.policy.enabled && classDay.is_class_day,
      occurrenceRef: classDay.occurrence_ref ?? 'occurrence_inactive',
      frozenCutoffs: classDay.occurrence_ref
        ? cutoffsByRef.get(classDay.occurrence_ref)
        : undefined,
    })),
  })
  const schedule = materializedSchedule.schedule

  const stagedRosterResult = await rpc(input.supabase,
    scopeMode === 'teacher_entitlements'
      ? 'stage_attendance_roster_snapshot_v2'
      : 'stage_attendance_roster_snapshot_v1', {
    p_teacher_id: input.teacherId,
    p_classroom_id: input.classroomId,
    p_source_token: prepared.data.roster_source_token,
    p_message: roster,
    ...(scopeMode === 'teacher_entitlements'
      ? { p_at: new Date().toISOString() }
      : {}),
  })
  const stagedScheduleResult = await rpc(
    input.supabase,
    'stage_attendance_timing_schedule_v1',
    {
      p_teacher_id: input.teacherId,
      p_classroom_id: input.classroomId,
      p_source_token: prepared.data.schedule_source_token,
      p_message: schedule,
      p_cutoffs: materializedSchedule.cutoffs,
      p_at: now.toISOString(),
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
    teacherId: input.teacherId,
    classroomId: input.classroomId,
    message: roster,
    scopeMode,
  })
  const scheduleResult = await deliverBaraAttendanceMessage({
    supabase: input.supabase,
    teacherId: input.teacherId,
    classroomId: input.classroomId,
    message: schedule,
    scopeMode,
  })

  return {
    roster: { outcome: rosterResult.outcome, revision: rosterResult.revision },
    schedule: { outcome: scheduleResult.outcome, revision: scheduleResult.revision },
  }
}
