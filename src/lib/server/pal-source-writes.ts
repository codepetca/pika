import { z } from 'zod'

import type { TiptapContent } from '@/types'
import type { v1 } from '@/vendor/pal-contract'

type SupabaseLike = any

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

function mapPalSourceWriteError(error: any, operation: string): never {
  if (error?.code === '42883' || error?.code === 'PGRST202') {
    throw new Error('Pal outbox migration is required')
  }
  throw new Error(`Failed to ${operation}: ${error?.message ?? 'unknown database error'}`)
}

export async function createClassroomEnrollmentWithPalEvent(input: {
  supabase: SupabaseLike
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
  supabase: SupabaseLike
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
      p_rich_content: input.richContent,
      p_minutes_reported: input.minutesReported ?? null,
      p_mood: input.mood ?? null,
      p_on_time: input.onTime,
      p_expected_version: input.expectedVersion ?? null,
      p_pal_event: input.event,
    },
  )
  if (error) mapPalSourceWriteError(error, 'save daily log')
  return entryResultSchema.parse(data)
}

export async function createAssignmentDocWithPalEvent(input: {
  supabase: SupabaseLike
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
