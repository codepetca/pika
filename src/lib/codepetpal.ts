import { createHmac } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

export const CODEPETPAL_EVENT_TYPES = [
  'daily_entry_created',
  'assignment_submitted',
  'calendar_milestone_reached',
  'resource_viewed',
  'quiz_completed_without_score',
] as const

export type CodePetPalEventType = (typeof CODEPETPAL_EVENT_TYPES)[number]

export type CodePetPalWorldView =
  | { enabled: false; error?: string }
  | {
      enabled: true
      world: {
        external_student_id: string
        external_classroom_id: string
        level: number
        xp: number
        xp_to_next_level: number
        xp_progress_percent: number
        mood: string
        streak_days: number
        assignment_submission_count: number
        pet: {
          species: string
          idle_asset_url: string
          happy_asset_url: string
        }
      }
      achievements: {
        unlocked: Array<{
          key: string
          title: string
          description: string
          asset_url: string | null
          unlocked_at: string
        }>
        locked: Array<{
          key: string
          title: string
          description: string
          asset_url: string | null
        }>
      }
      recent_events: Array<{
        id: string
        type: string
        occurred_at: string
      }>
      next_nudge: string
    }

type CodePetPalEventInput = {
  idempotency_key: string
  type: CodePetPalEventType
  occurred_at: string
  external_student_id: string
  external_classroom_id: string
  payload?: Record<string, unknown>
}

type CodePetPalOutboxRow = {
  id: string
  classroom_id: string
  student_id: string
  event_type: CodePetPalEventType
  idempotency_key: string
  occurred_at: string
  payload: Record<string, unknown> | null
  attempt_count: number
}

export const codePetPalLookupQuerySchema = z.object({
  classroom_id: z.string().uuid(),
})

export function isCodePetPalRuntimeConfigured() {
  return Boolean(getCodePetPalBaseUrl() && process.env.CODEPETPAL_API_KEY)
}

export async function enqueueCodePetPalEvent(
  supabase: SupabaseClient,
  input: {
    classroomId: string
    studentId: string
    eventType: CodePetPalEventType
    sourceId: string
    occurredAt?: string
    payload?: Record<string, unknown>
  },
) {
  try {
    const { data: classroom, error: classroomError } = await supabase
      .from('classrooms')
      .select('codepetpal_enabled')
      .eq('id', input.classroomId)
      .single()

    if (classroomError || !classroom?.codepetpal_enabled) {
      return { queued: false, reason: classroomError ? 'lookup_failed' : 'disabled' }
    }

    const idempotencyKey = buildCodePetPalIdempotencyKey(input.eventType, input.sourceId)
    const { error } = await supabase
      .from('integration_event_outbox')
      .upsert({
        integration_key: 'codepetpal',
        classroom_id: input.classroomId,
        student_id: input.studentId,
        event_type: input.eventType,
        idempotency_key: idempotencyKey,
        occurred_at: input.occurredAt || new Date().toISOString(),
        payload: input.payload || {},
        status: 'pending',
        next_attempt_at: new Date().toISOString(),
      }, { onConflict: 'idempotency_key', ignoreDuplicates: true })

    if (error) {
      console.error('CodePetPal outbox enqueue failed:', error)
      return { queued: false, reason: 'insert_failed' }
    }

    return { queued: true, idempotencyKey }
  } catch (error) {
    console.error('CodePetPal outbox enqueue failed:', error)
    return { queued: false, reason: 'unexpected_error' }
  }
}

export async function drainCodePetPalOutbox(
  supabase: SupabaseClient,
  options: { limit?: number } = {},
) {
  const baseUrl = getCodePetPalBaseUrl()
  const apiKey = process.env.CODEPETPAL_API_KEY
  if (!baseUrl || !apiKey) {
    return { ok: false, status: 'unconfigured', selected: 0, sent: 0, failed: 0 }
  }

  const now = new Date().toISOString()
  const { data: rows, error } = await supabase
    .from('integration_event_outbox')
    .select('id, classroom_id, student_id, event_type, idempotency_key, occurred_at, payload, attempt_count')
    .eq('integration_key', 'codepetpal')
    .in('status', ['pending', 'failed'])
    .lte('next_attempt_at', now)
    .order('created_at', { ascending: true })
    .limit(options.limit || 50)

  if (error) {
    console.error('CodePetPal outbox select failed:', error)
    return { ok: false, status: 'select_failed', selected: 0, sent: 0, failed: 0 }
  }

  const outboxRows = ((rows || []) as CodePetPalOutboxRow[])
  if (outboxRows.length === 0) {
    return { ok: true, status: 'empty', selected: 0, sent: 0, failed: 0 }
  }

  const batch = outboxRows.map(toCodePetPalEvent)

  try {
    const response = await fetch(`${baseUrl}/api/v1/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ events: batch }),
    })
    const payload = await response.json().catch(() => null)
    return markOutboxDeliveryResult(supabase, outboxRows, response.ok, payload)
  } catch (sendError) {
    const message = sendError instanceof Error ? sendError.message : 'CodePetPal delivery failed'
    await markOutboxRowsFailed(supabase, outboxRows, message)
    return {
      ok: false,
      status: 'send_failed',
      selected: outboxRows.length,
      sent: 0,
      failed: outboxRows.length,
    }
  }
}

export async function lookupCodePetPalWorld(input: {
  classroomId: string
  studentId: string
}): Promise<CodePetPalWorldView> {
  const baseUrl = getCodePetPalBaseUrl()
  const apiKey = process.env.CODEPETPAL_API_KEY
  if (!baseUrl || !apiKey) {
    return { enabled: false, error: 'unconfigured' }
  }

  try {
    const response = await fetch(`${baseUrl}/api/v1/worlds/lookup`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        external_student_id: pseudonymousExternalId('student', input.studentId),
        external_classroom_id: pseudonymousExternalId('classroom', input.classroomId),
      }),
    })

    if (!response.ok) {
      return { enabled: false, error: `lookup_failed:${response.status}` }
    }

    return await response.json() as CodePetPalWorldView
  } catch (error) {
    console.error('CodePetPal world lookup failed:', error)
    return { enabled: false, error: 'lookup_failed' }
  }
}

function toCodePetPalEvent(row: CodePetPalOutboxRow): CodePetPalEventInput {
  return {
    idempotency_key: row.idempotency_key,
    type: row.event_type,
    occurred_at: row.occurred_at,
    external_student_id: pseudonymousExternalId('student', row.student_id),
    external_classroom_id: pseudonymousExternalId('classroom', row.classroom_id),
    payload: row.payload || {},
  }
}

async function markOutboxDeliveryResult(
  supabase: SupabaseClient,
  rows: CodePetPalOutboxRow[],
  responseOk: boolean,
  payload: any,
) {
  const resultRows = Array.isArray(payload?.results) ? payload.results : []
  const resultByKey = new Map(resultRows.map((result: any) => [result.idempotency_key, result]))
  let sent = 0
  let failed = 0

  for (const row of rows) {
    const result = resultByKey.get(row.idempotency_key) as { status?: string; error?: string } | undefined
    if (result?.status === 'failed') {
      await markOutboxRowFailed(
        supabase,
        row,
        result.error || payload?.error || `CodePetPal returned a retryable response`,
      )
      failed += 1
      continue
    }

    if (result?.status === 'processed' || result?.status === 'duplicate') {
      await markOutboxRowSent(supabase, row)
      sent += 1
      continue
    }

    await markOutboxRowFailed(
      supabase,
      row,
      result?.error ||
        payload?.error ||
        (responseOk ? 'CodePetPal response omitted this event result' : 'CodePetPal returned a retryable response'),
    )
    failed += 1
  }

  return {
    ok: failed === 0,
    status: failed === 0 ? 'sent' : 'partial_failed',
    selected: rows.length,
    sent,
    failed,
  }
}

async function markOutboxRowSent(supabase: SupabaseClient, row: CodePetPalOutboxRow) {
  const now = new Date().toISOString()
  await supabase
    .from('integration_event_outbox')
    .update({
      status: 'sent',
      attempt_count: row.attempt_count + 1,
      last_attempt_at: now,
      last_error: null,
      sent_at: now,
    })
    .eq('id', row.id)
}

async function markOutboxRowsFailed(
  supabase: SupabaseClient,
  rows: CodePetPalOutboxRow[],
  message: string,
) {
  for (const row of rows) {
    await markOutboxRowFailed(supabase, row, message)
  }
}

async function markOutboxRowFailed(
  supabase: SupabaseClient,
  row: CodePetPalOutboxRow,
  message: string,
) {
  const now = new Date().toISOString()
  const nextAttempt = new Date(Date.now() + backoffMs(row.attempt_count + 1)).toISOString()
  await supabase
    .from('integration_event_outbox')
    .update({
      status: 'failed',
      attempt_count: row.attempt_count + 1,
      last_attempt_at: now,
      last_error: message.slice(0, 1000),
      next_attempt_at: nextAttempt,
    })
    .eq('id', row.id)
}

function getCodePetPalBaseUrl() {
  return process.env.CODEPETPAL_API_URL?.replace(/\/+$/, '') || ''
}

function buildCodePetPalIdempotencyKey(eventType: CodePetPalEventType, sourceId: string) {
  return `pika:${eventType}:${hmacDigest(`event:${eventType}:${sourceId}`)}`
}

function pseudonymousExternalId(kind: 'student' | 'classroom', rawId: string) {
  return `pika_${kind}_${hmacDigest(`${kind}:${rawId}`)}`
}

function hmacDigest(value: string) {
  return createHmac('sha256', codePetPalPseudonymSecret()).update(value).digest('hex').slice(0, 32)
}

function codePetPalPseudonymSecret() {
  const secret = process.env.CODEPETPAL_PSEUDONYM_SECRET || process.env.SESSION_SECRET
  if (!secret) {
    throw new Error('CODEPETPAL_PSEUDONYM_SECRET or SESSION_SECRET is required for CodePetPal pseudonymous IDs')
  }
  return secret
}

function backoffMs(attemptCount: number) {
  const minutes = Math.min(60, 2 ** Math.max(0, attemptCount - 1))
  return minutes * 60_000
}
