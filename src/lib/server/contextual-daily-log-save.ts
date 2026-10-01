import { z } from 'zod'

import { ApiError } from '@/lib/api-error'
import { isRetryableDatabaseContention } from '@/lib/server/database-contention'
import { getServiceRoleClient } from '@/lib/supabase'
import { isValidTiptapContent } from '@/lib/tiptap-content'
import type { TiptapContent } from '@/types'
import type { Json } from '@/types/database.generated'
import type { v1 } from '@/vendor/pal-contract'

export type ContextualDailyLogSaveClient = Pick<ReturnType<typeof getServiceRoleClient>, 'rpc'>

const canonicalUuid = z.string().uuid().transform((value) => value.toLowerCase())
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const tiptapContent = z.custom<TiptapContent>(isValidTiptapContent)
const entrySchema = z.object({
  id: canonicalUuid,
  student_id: canonicalUuid,
  classroom_id: canonicalUuid,
  date: dateSchema,
  text: z.string(),
  rich_content: tiptapContent.nullable(),
  minutes_reported: z.number().int().nullable(),
  mood: z.string().nullable(),
  on_time: z.boolean(),
  version: z.number().int().positive(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
}).strict()

const postPreimageSchema = z.object({
  id: canonicalUuid,
  student_id: canonicalUuid,
  classroom_id: canonicalUuid,
  date: dateSchema,
  version: z.number().int().positive(),
  minutes_reported: z.number().int().nullable(),
  mood: z.string().nullable(),
}).strict()

const resultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    created: z.boolean(),
    entry: entrySchema,
  }).strict(),
  z.object({
    ok: z.literal(false),
    status: z.literal(409),
    error: z.literal('Entry has been updated elsewhere'),
    entry: entrySchema.nullable(),
  }).strict(),
])

export type ContextualDailyLogEntry = z.infer<typeof entrySchema>
export type ContextualDailyLogSaveResult =
  | { ok: true; created: boolean; entry: ContextualDailyLogEntry }
  | { ok: false; status: 409; error: 'Entry has been updated elsewhere'; entry: ContextualDailyLogEntry | null }

function mapRpcError(code: string | undefined): never {
  if (code === '42501') throw new ApiError(403, 'Forbidden')
  if (code === 'P0002') throw new ApiError(404, 'Entry not found')
  if (code === '22023') throw new ApiError(400, 'Invalid daily log save request')
  if (code === '40001' || code === '55P03' || isRetryableDatabaseContention({ code })) {
    throw new ApiError(409, 'Entry changed during this update. Refresh and try again.')
  }
  throw new ApiError(503, 'Unable to save daily log')
}

function parseContext(input: {
  actorId: string
  classroomId: string
  date: string
  expectedVersion: number | null
  expectedEntryId: string | null
}) {
  const actorId = canonicalUuid.safeParse(input.actorId)
  const classroomId = canonicalUuid.safeParse(input.classroomId)
  const date = dateSchema.safeParse(input.date)
  const expectedEntryId = input.expectedEntryId === null
    ? { success: true as const, data: null }
    : canonicalUuid.safeParse(input.expectedEntryId)
  if (
    !actorId.success
    || !classroomId.success
    || !date.success
    || !expectedEntryId.success
    || (input.expectedVersion !== null && (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1))
    || ((input.expectedVersion === null) !== (expectedEntryId.data === null))
  ) {
    throw new ApiError(400, 'Invalid daily log save request')
  }
  return { actorId: actorId.data, classroomId: classroomId.data, date: date.data, expectedEntryId: expectedEntryId.data }
}

function verifyEntryBinding(entry: ContextualDailyLogEntry, context: {
  actorId: string
  classroomId: string
  date: string
  expectedEntryId: string | null
}, requireExpectedEntryId: boolean) {
  if (
    entry.student_id !== context.actorId
    || entry.classroom_id !== context.classroomId
    || entry.date !== context.date
    || (requireExpectedEntryId && context.expectedEntryId !== null && entry.id !== context.expectedEntryId)
  ) {
    throw new ApiError(503, 'Unable to verify daily log save')
  }
}

function verifyPreimageBinding<T extends {
  student_id: string
  classroom_id: string
  date: string
}>(entry: T, context: { actorId: string; classroomId: string; date: string }): T {
  if (
    entry.student_id !== context.actorId
    || entry.classroom_id !== context.classroomId
    || entry.date !== context.date
  ) {
    throw new ApiError(503, 'Unable to verify daily log preimage')
  }
  return entry
}

/** Validates the minimal, bound POST preimage before preserving optional fields. */
export function verifyContextualDailyLogPostPreimage(input: {
  actorId: string
  classroomId: string
  date: string
  entry: unknown
}): z.infer<typeof postPreimageSchema> | null {
  if (input.entry === null) return null
  const context = parseContext({ ...input, expectedVersion: null, expectedEntryId: null })
  const parsed = postPreimageSchema.safeParse(input.entry)
  if (!parsed.success) throw new ApiError(503, 'Unable to verify daily log preimage')
  return verifyPreimageBinding(parsed.data, context)
}

/** Validates the full contextual PATCH preimage before patching or returning it. */
export function verifyContextualDailyLogPatchPreimage(input: {
  actorId: string
  classroomId: string
  date: string
  entry: unknown
}): ContextualDailyLogEntry | null {
  if (input.entry === null) return null
  const context = parseContext({ ...input, expectedVersion: null, expectedEntryId: null })
  const parsed = entrySchema.safeParse(input.entry)
  if (!parsed.success) throw new ApiError(503, 'Unable to verify daily log preimage')
  return verifyPreimageBinding(parsed.data, context)
}

/**
 * The contextual transaction is the only write authority for shared-admission
 * Daily Log saves. Its response is verified before a route may expose it.
 */
export async function saveContextualDailyLog(input: {
  supabase: ContextualDailyLogSaveClient
  actorId: string
  classroomId: string
  date: string
  text: string
  richContent: TiptapContent
  minutesReported?: number | null
  mood?: string | null
  onTime: boolean
  palEvent: v1.DailyLogCompletedEvent | null
  expectedVersion: number | null
  expectedEntryId: string | null
}): Promise<ContextualDailyLogSaveResult> {
  const context = parseContext(input)
  const { data, error } = await input.supabase.rpc('save_daily_log_for_member_v1', {
    p_actor_id: context.actorId,
    p_classroom_id: context.classroomId,
    p_date: context.date,
    p_text: input.text,
    p_rich_content: input.richContent as unknown as Json,
    p_on_time: input.onTime,
    ...(input.palEvent === null ? {} : { p_pal_event: input.palEvent as unknown as Json }),
    ...(input.minutesReported == null ? {} : { p_minutes_reported: input.minutesReported }),
    ...(input.mood == null ? {} : { p_mood: input.mood }),
    ...(input.expectedVersion === null ? {} : { p_expected_version: input.expectedVersion }),
    ...(context.expectedEntryId === null ? {} : { p_expected_entry_id: context.expectedEntryId }),
  })
  if (error) mapRpcError(error.code)

  const parsed = resultSchema.safeParse(data)
  if (!parsed.success) throw new ApiError(503, 'Unable to verify daily log save')
  if (parsed.data.entry !== null) verifyEntryBinding(parsed.data.entry, context, parsed.data.ok)
  return parsed.data
}
