import { z } from 'zod'

import { getServiceRoleClient } from '@/lib/supabase'
import type { TiptapContent } from '@/types'
import type { Json } from '@/types/database.generated'
import type { v1 } from '@/vendor/pal-contract'

export type PalSourceWriteClient = Pick<
  ReturnType<typeof getServiceRoleClient>,
  'rpc'
>

const enrollmentResultSchema = z.object({
  ok: z.literal(true),
  created: z.boolean(),
  enrollment: z.object({ id: z.string().min(1) }).passthrough(),
}).strip()

const entryResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    created: z.boolean(),
    entry: z.object({ id: z.string().min(1) }).passthrough(),
  }).strip(),
  z.object({
    ok: z.literal(false),
    status: z.literal(409),
    error: z.string().min(1),
    entry: z.object({ id: z.string().min(1) }).passthrough().nullable(),
  }).strip(),
])

const assignmentDocResultSchema = z.object({
  ok: z.literal(true),
  created: z.boolean(),
  doc: z.object({ id: z.string().min(1) }).passthrough(),
}).strip()

function mapPalSourceWriteError(error: unknown, operation: string): never {
  const rpcError = typeof error === 'object' && error !== null
    ? error as { code?: unknown; message?: unknown }
    : {}
  if (rpcError.code === '42883' || rpcError.code === 'PGRST202') {
    throw new Error('Pal outbox migration is required')
  }
  const message = typeof rpcError.message === 'string'
    ? rpcError.message
    : 'unknown database error'
  throw new Error(`Failed to ${operation}: ${message}`)
}

export async function createClassroomEnrollmentWithPalEvent(input: {
  supabase: PalSourceWriteClient
  classroomId: string
  studentId: string
  event: v1.ClassroomJoinedEvent | null
}) {
  const { data, error } = await input.supabase.rpc(
    'create_classroom_enrollment_with_pal_event_atomic',
    {
      p_classroom_id: input.classroomId,
      p_student_id: input.studentId,
      p_pal_event: input.event,
    },
  )
  if (error) mapPalSourceWriteError(error, 'create classroom enrollment')
  return enrollmentResultSchema.parse(data)
}

export async function upsertStudentEntryWithPalEvent(input: {
  supabase: PalSourceWriteClient
  studentId: string
  classroomId: string
  date: string
  text: string
  richContent: TiptapContent
  minutesReported?: number | null
  mood?: string | null
  onTime: boolean
  expectedVersion?: number | null
  event: v1.DailyLogCompletedEvent | null
}) {
  const { data, error } = await input.supabase.rpc(
    'upsert_student_entry_with_pal_event_atomic',
    {
      p_student_id: input.studentId,
      p_classroom_id: input.classroomId,
      p_date: input.date,
      p_text: input.text,
      p_rich_content: input.richContent as unknown as Json,
      p_on_time: input.onTime,
      p_pal_event: input.event,
      ...(input.minutesReported == null
        ? {}
        : { p_minutes_reported: input.minutesReported }),
      ...(input.mood == null ? {} : { p_mood: input.mood }),
      ...(input.expectedVersion == null
        ? {}
        : { p_expected_version: input.expectedVersion }),
    },
  )
  if (error) mapPalSourceWriteError(error, 'save daily log')
  return entryResultSchema.parse(data)
}

export async function createAssignmentDocWithPalEvent(input: {
  supabase: PalSourceWriteClient
  assignmentId: string
  studentId: string
  viewedAt: string
  event: v1.LearningItemViewedEvent | null
}) {
  const { data, error } = await input.supabase.rpc(
    'create_assignment_doc_with_pal_event_atomic',
    {
      p_assignment_id: input.assignmentId,
      p_student_id: input.studentId,
      p_viewed_at: input.viewedAt,
      p_pal_event: input.event,
    },
  )
  if (error) mapPalSourceWriteError(error, 'create assignment document')
  return assignmentDocResultSchema.parse(data)
}
