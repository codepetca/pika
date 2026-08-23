import { z } from 'zod'

import { getServiceRoleClient } from '@/lib/supabase'
import {
  BaraAttendanceClientError,
  type BaraAttendanceMarksResult,
  type BaraRosterSnapshotResult,
  type BaraScheduleSnapshotResult,
  type BaraSessionCommandResult,
  postBaraAttendanceMarks,
  postBaraSessionCommand,
  putBaraRosterSnapshot,
  putBaraScheduleSnapshot,
} from '@/lib/server/bara-attendance-client'
import type {
  V1AttendanceMarks,
  V1Message,
  V1RosterSnapshot,
  V1ScheduleSnapshot,
  V1SessionCommand,
} from '@/vendor/attendance-contract/v1/types'
import { validateV1Message } from '@/vendor/attendance-contract/v1/validate'
import {
  getBaraAttendanceScopeMode,
  type BaraAttendanceScopeMode,
} from '@/lib/server/bara-attendance-scope'

type V1OutboxMessage =
  | V1RosterSnapshot
  | V1ScheduleSnapshot
  | V1SessionCommand
  | V1AttendanceMarks

export type BaraAttendanceDeliveryResult =
  | BaraRosterSnapshotResult
  | BaraScheduleSnapshotResult
  | BaraSessionCommandResult
  | BaraAttendanceMarksResult

export type AttendanceOutboxClient = Pick<
  ReturnType<typeof getServiceRoleClient>,
  'rpc'
>

async function callOutboxRpc(
  supabase: AttendanceOutboxClient,
  name: string,
  args?: Record<string, unknown>,
) {
  const rpc = supabase.rpc as unknown as (
    functionName: string,
    functionArgs?: Record<string, unknown>,
  ) => PromiseLike<{
    data: unknown
    error: { code?: string; message?: string } | null
  }>
  return await rpc.call(supabase, name, args)
}

const messageTypeSchema = z.enum([
  'roster.snapshot',
  'schedule.snapshot',
  'session.command',
  'attendance.marks',
])

const outboxRowSchema = z.object({
  id: z.string().uuid(),
  classroom_id: z.string().uuid(),
  idempotency_key: z.string().min(1).max(200),
  message_type: messageTypeSchema,
  payload: z.unknown(),
  response_payload: z.unknown().nullable(),
  status: z.enum(['pending', 'processing', 'delivered', 'non_retryable', 'superseded']),
  attempts: z.number().int().nonnegative(),
  lease_token: z.string().uuid().nullable(),
}).passthrough()

function isNoClaimResult(value: unknown): boolean {
  if (value === null) return true
  if (typeof value !== 'object' || Array.isArray(value)) return false
  const composite = value as Record<string, unknown>
  const requiredCompositeFields = [
    'id',
    'classroom_id',
    'idempotency_key',
    'message_type',
    'payload',
    'response_payload',
    'status',
    'attempts',
    'lease_token',
  ]
  return requiredCompositeFields.every((field) =>
    Object.hasOwn(composite, field) && composite[field] === null)
    && Object.values(composite).every((field) => field === null)
}

function parseOutboxRow(value: unknown) {
  const parsed = outboxRowSchema.safeParse(value)
  if (!parsed.success) {
    throw new BaraAttendanceOutboxError(
      'Stored attendance outbox state is invalid',
      'invalid_stored_message',
      false,
    )
  }
  return parsed.data
}

const rosterResultSchema = z.object({
  outcome: z.enum(['applied', 'duplicate']),
  rosterRef: z.string(),
  revision: z.number().int().positive(),
  createdCount: z.number().int().nonnegative(),
  updatedCount: z.number().int().nonnegative(),
  deactivatedCount: z.number().int().nonnegative(),
}).strict()

const scheduleResultSchema = z.object({
  outcome: z.enum(['applied', 'duplicate']),
  rosterRef: z.string(),
  revision: z.number().int().positive(),
  scheduledCount: z.number().int().nonnegative(),
  updatedCount: z.number().int().nonnegative(),
  cancelledCount: z.number().int().nonnegative(),
  preservedCount: z.number().int().nonnegative(),
}).strict()

const sessionResultSchema = z.object({
  outcome: z.enum(['applied', 'duplicate', 'unchanged']),
  occurrenceRef: z.string(),
  status: z.enum(['open', 'closed']),
  sessionRevision: z.number().int().positive(),
}).strict()

const marksResultSchema = z.object({
  outcome: z.enum(['applied', 'duplicate']),
  occurrenceRef: z.string(),
  sessionRevision: z.number().int().positive(),
  appliedCount: z.number().int().nonnegative(),
  unchangedCount: z.number().int().nonnegative(),
}).strict()

export class BaraAttendanceOutboxError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'migration_required'
      | 'persistence_failed'
      | 'idempotency_conflict'
      | 'delivery_pending'
      | 'invalid_stored_message'
      | 'lease_lost',
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'BaraAttendanceOutboxError'
  }
}

function mapDatabaseError(
  error: { code?: string; message?: string } | null,
  operation: string,
): never {
  if (error?.code === '42883' || error?.code === 'PGRST202') {
    throw new BaraAttendanceOutboxError(
      'Bara attendance outbox migration is required',
      'migration_required',
      false,
    )
  }
  if (error?.code === '23505') {
    throw new BaraAttendanceOutboxError(
      'Attendance request reused an idempotency key with different content',
      'idempotency_conflict',
      false,
    )
  }
  throw new BaraAttendanceOutboxError(
    `Failed to ${operation}`,
    'persistence_failed',
    true,
  )
}

function parseResult(
  messageType: V1OutboxMessage['message_type'],
  value: unknown,
): BaraAttendanceDeliveryResult {
  switch (messageType) {
    case 'roster.snapshot': return rosterResultSchema.parse(value)
    case 'schedule.snapshot': return scheduleResultSchema.parse(value)
    case 'session.command': return sessionResultSchema.parse(value)
    case 'attendance.marks': return marksResultSchema.parse(value)
  }
}

async function sendMessage(message: V1OutboxMessage): Promise<BaraAttendanceDeliveryResult> {
  switch (message.message_type) {
    case 'roster.snapshot': return putBaraRosterSnapshot(message)
    case 'schedule.snapshot': return putBaraScheduleSnapshot(message)
    case 'session.command': return postBaraSessionCommand(message)
    case 'attendance.marks': return postBaraAttendanceMarks(message)
  }
}

function isOutboxMessage(message: V1Message): message is V1OutboxMessage {
  return message.message_type === 'roster.snapshot'
    || message.message_type === 'schedule.snapshot'
    || message.message_type === 'session.command'
    || message.message_type === 'attendance.marks'
}

function retryAt(attempts: number, now: Date) {
  const delaySeconds = Math.min(3_600, 30 * 2 ** Math.min(7, Math.max(0, attempts - 1)))
  return new Date(now.getTime() + delaySeconds * 1_000).toISOString()
}

function deliveryFailure(error: unknown) {
  if (error instanceof BaraAttendanceOutboxError) {
    return {
      code: error.code,
      detail: 'Attendance outbox delivery failed',
      retryable: error.retryable,
    }
  }
  if (error instanceof BaraAttendanceClientError) {
    return {
      code: error.code.slice(0, 100),
      detail: `Bara delivery failed (${error.code})`.slice(0, 500),
      retryable: error.retryable,
    }
  }
  if (error instanceof z.ZodError) {
    return {
      code: 'invalid_stored_message',
      detail: 'Stored attendance message failed contract validation',
      retryable: false,
    }
  }
  return {
    code: 'unexpected_delivery_error',
    detail: 'Unexpected attendance delivery error',
    retryable: true,
  }
}

async function transition(
  supabase: AttendanceOutboxClient,
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await callOutboxRpc(supabase, name, args)
  if (error) mapDatabaseError(error, 'record attendance delivery state')
  if (data !== true) {
    throw new BaraAttendanceOutboxError(
      'Attendance delivery lease was lost',
      'lease_lost',
      true,
    )
  }
}

async function recordFailure(input: {
  supabase: AttendanceOutboxClient
  row: z.infer<typeof outboxRowSchema>
  error: unknown
  now: Date
}) {
  if (!input.row.lease_token) {
    throw new BaraAttendanceOutboxError('Attendance delivery lease was lost', 'lease_lost', true)
  }
  const failure = deliveryFailure(input.error)
  await transition(
    input.supabase,
    failure.retryable ? 'retry_attendance_outbox_v1' : 'fail_attendance_outbox_v1',
    {
      p_outbox_id: input.row.id,
      p_lease_token: input.row.lease_token,
      ...(failure.retryable
        ? { p_next_attempt_at: retryAt(input.row.attempts, input.now) }
        : {}),
      p_error_code: failure.code,
      p_error_detail: failure.detail,
    },
  )
}

async function deliverClaimed(input: {
  supabase: AttendanceOutboxClient
  row: z.infer<typeof outboxRowSchema>
  now: Date
  deliver?: (message: V1OutboxMessage) => Promise<BaraAttendanceDeliveryResult>
  scopeMode?: BaraAttendanceScopeMode
}) {
  const validation = validateV1Message(input.row.payload)
  if (
    !validation.ok ||
    !isOutboxMessage(validation.value) ||
    validation.value.message_type !== input.row.message_type ||
    validation.value.idempotency_key !== input.row.idempotency_key
  ) {
    const error = new z.ZodError([])
    await recordFailure({ ...input, error })
    throw new BaraAttendanceOutboxError(
      'Stored attendance message failed contract validation',
      'invalid_stored_message',
      false,
    )
  }

  try {
    const result = await (input.deliver ?? sendMessage)(validation.value)
    if (!input.row.lease_token) {
      throw new BaraAttendanceOutboxError('Attendance delivery lease was lost', 'lease_lost', true)
    }
    await transition(input.supabase,
      input.scopeMode === 'teacher_entitlements'
        ? 'complete_attendance_outbox_v2'
        : 'complete_attendance_outbox_v1', {
      p_outbox_id: input.row.id,
      p_lease_token: input.row.lease_token,
      p_response_payload: result,
    })
    return result
  } catch (error) {
    if (error instanceof BaraAttendanceOutboxError && error.code === 'lease_lost') throw error
    await recordFailure({ ...input, error })
    throw error
  }
}

export async function deliverBaraAttendanceMessage(input: {
  supabase: AttendanceOutboxClient
  teacherId?: string
  classroomId: string
  message: V1RosterSnapshot
  scopeMode?: BaraAttendanceScopeMode
  now?: Date
  deliver?: (message: V1OutboxMessage) => Promise<BaraAttendanceDeliveryResult>
}): Promise<BaraRosterSnapshotResult>
export async function deliverBaraAttendanceMessage(input: {
  supabase: AttendanceOutboxClient
  teacherId?: string
  classroomId: string
  message: V1ScheduleSnapshot
  scopeMode?: BaraAttendanceScopeMode
  now?: Date
  deliver?: (message: V1OutboxMessage) => Promise<BaraAttendanceDeliveryResult>
}): Promise<BaraScheduleSnapshotResult>
export async function deliverBaraAttendanceMessage(input: {
  supabase: AttendanceOutboxClient
  teacherId?: string
  classroomId: string
  message: V1SessionCommand
  scopeMode?: BaraAttendanceScopeMode
  now?: Date
  deliver?: (message: V1OutboxMessage) => Promise<BaraAttendanceDeliveryResult>
}): Promise<BaraSessionCommandResult>
export async function deliverBaraAttendanceMessage(input: {
  supabase: AttendanceOutboxClient
  teacherId?: string
  classroomId: string
  message: V1AttendanceMarks
  scopeMode?: BaraAttendanceScopeMode
  now?: Date
  deliver?: (message: V1OutboxMessage) => Promise<BaraAttendanceDeliveryResult>
}): Promise<BaraAttendanceMarksResult>
export async function deliverBaraAttendanceMessage(input: {
  supabase: AttendanceOutboxClient
  teacherId?: string
  classroomId: string
  message: V1OutboxMessage
  scopeMode?: BaraAttendanceScopeMode
  now?: Date
  deliver?: (message: V1OutboxMessage) => Promise<BaraAttendanceDeliveryResult>
}): Promise<BaraAttendanceDeliveryResult> {
  const validation = validateV1Message(input.message)
  if (!validation.ok || !isOutboxMessage(validation.value)) {
    throw new BaraAttendanceClientError('Invalid Bara attendance message', 'invalid_payload', false)
  }
  const scopeMode = input.scopeMode ?? getBaraAttendanceScopeMode()
  if (scopeMode === 'teacher_entitlements' && !input.teacherId) {
    throw new BaraAttendanceOutboxError(
      'Attendance message owner is required',
      'persistence_failed',
      false,
    )
  }

  const { data, error } = await callOutboxRpc(
    input.supabase,
    scopeMode === 'teacher_entitlements'
      ? 'enqueue_attendance_outbound_message_v2'
      : 'enqueue_attendance_outbound_message_v1',
    {
      ...(scopeMode === 'teacher_entitlements'
        ? { p_teacher_id: input.teacherId, p_at: (input.now ?? new Date()).toISOString() }
        : {}),
      p_classroom_id: input.classroomId,
      p_message: validation.value,
    },
  )
  if (error) mapDatabaseError(error, 'persist attendance message')
  const enqueued = parseOutboxRow(data)
  if (enqueued.status === 'delivered') {
    return parseResult(validation.value.message_type, enqueued.response_payload)
  }
  if (enqueued.status === 'non_retryable') {
    throw new BaraAttendanceOutboxError(
      'Attendance message requires operator review',
      'delivery_pending',
      false,
    )
  }
  if (enqueued.status === 'superseded') {
    throw new BaraAttendanceOutboxError(
      'Attendance message was superseded by an authorization change',
      'delivery_pending',
      false,
    )
  }

  const claim = await callOutboxRpc(input.supabase,
    scopeMode === 'teacher_entitlements'
      ? 'claim_attendance_outbound_message_v2'
      : 'claim_attendance_outbound_message_v1', {
    ...(scopeMode === 'teacher_entitlements'
      ? { p_teacher_id: input.teacherId, p_classroom_id: input.classroomId }
      : {}),
    p_idempotency_key: validation.value.idempotency_key,
    p_lease_seconds: 60,
  })
  if (claim.error) mapDatabaseError(claim.error, 'claim attendance message')
  // PostgreSQL composite-returning functions may reach PostgREST as either a
  // literal null or an object whose every composite field is null. Both mean
  // that the durable row exists but no dependency-ready lease was acquired.
  if (isNoClaimResult(claim.data)) {
    throw new BaraAttendanceOutboxError(
      'Attendance message is already awaiting delivery',
      'delivery_pending',
      true,
    )
  }
  const result = await deliverClaimed({
    supabase: input.supabase,
    row: parseOutboxRow(claim.data),
    now: input.now ?? new Date(),
    deliver: input.deliver,
    scopeMode,
  })
  return parseResult(validation.value.message_type, result)
}

export interface AttendanceOutboxDeliverySummary {
  status: 'disabled' | 'ok' | 'partial'
  claimed: number
  delivered: number
  retrying: number
  nonRetryable: number
}

export async function deliverBaraAttendanceOutboxBatch(input: {
  supabase: AttendanceOutboxClient
  enabled: boolean
  teacherId?: string | null
  classroomId?: string | null
  scopeMode?: BaraAttendanceScopeMode
  limit?: number
  now?: Date
  deliver?: (message: V1OutboxMessage) => Promise<BaraAttendanceDeliveryResult>
}): Promise<AttendanceOutboxDeliverySummary> {
  const scopeMode = input.scopeMode ?? getBaraAttendanceScopeMode()
  if (!input.enabled || (scopeMode === 'exact_canary' && (!input.teacherId || !input.classroomId))) {
    return { status: 'disabled', claimed: 0, delivered: 0, retrying: 0, nonRetryable: 0 }
  }
  const { data, error } = await callOutboxRpc(input.supabase,
    scopeMode === 'teacher_entitlements'
      ? 'claim_attendance_outbox_batch_v3'
      : 'claim_attendance_outbox_batch_v2', {
    ...(scopeMode === 'exact_canary'
      ? { p_teacher_id: input.teacherId, p_classroom_id: input.classroomId }
      : {}),
    p_limit: input.limit ?? 20,
    p_lease_seconds: 60,
  })
  if (error) mapDatabaseError(error, 'claim attendance outbox batch')
  const rows = z.array(outboxRowSchema).parse(data ?? [])
  const summary: AttendanceOutboxDeliverySummary = {
    status: 'ok',
    claimed: rows.length,
    delivered: 0,
    retrying: 0,
    nonRetryable: 0,
  }

  for (const row of rows) {
    try {
      await deliverClaimed({
        supabase: input.supabase,
        row,
        now: input.now ?? new Date(),
        deliver: input.deliver,
        scopeMode,
      })
      summary.delivered += 1
    } catch (deliveryError) {
      const failure = deliveryFailure(deliveryError)
      if (failure.retryable) summary.retrying += 1
      else summary.nonRetryable += 1
    }
  }
  if (summary.retrying > 0 || summary.nonRetryable > 0) {
    summary.status = 'partial'
  }
  return summary
}

const outboxHealthSchema = z.object({
  pending: z.number().int().nonnegative(),
  processing: z.number().int().nonnegative(),
  non_retryable: z.number().int().nonnegative(),
  due: z.number().int().nonnegative(),
  oldest_unresolved_at: z.string().datetime({ offset: true }).nullable(),
}).strict()

export interface AttendanceOutboxHealthSummary {
  status: 'disabled' | 'ok' | 'degraded'
  pending: number
  processing: number
  nonRetryable: number
  due: number
  oldestUnresolvedAt: string | null
}

export async function getBaraAttendanceOutboxHealth(input: {
  supabase: AttendanceOutboxClient
  enabled: boolean
  teacherId?: string | null
  classroomId?: string | null
  scopeMode?: BaraAttendanceScopeMode
}): Promise<AttendanceOutboxHealthSummary> {
  const scopeMode = input.scopeMode ?? getBaraAttendanceScopeMode()
  if (!input.enabled || (scopeMode === 'exact_canary' && (!input.teacherId || !input.classroomId))) {
    return {
      status: 'disabled',
      pending: 0,
      processing: 0,
      nonRetryable: 0,
      due: 0,
      oldestUnresolvedAt: null,
    }
  }

  const { data, error } = await callOutboxRpc(input.supabase,
    scopeMode === 'teacher_entitlements'
      ? 'attendance_outbox_health_v3'
      : 'attendance_outbox_health_v2', {
    ...(scopeMode === 'exact_canary'
      ? { p_teacher_id: input.teacherId, p_classroom_id: input.classroomId }
      : {}),
  })
  if (error) mapDatabaseError(error, 'read attendance outbox health')
  const health = outboxHealthSchema.parse(data)
  const unresolved = health.pending + health.processing + health.non_retryable

  return {
    status: unresolved > 0 ? 'degraded' : 'ok',
    pending: health.pending,
    processing: health.processing,
    nonRetryable: health.non_retryable,
    due: health.due,
    oldestUnresolvedAt: health.oldest_unresolved_at,
  }
}
