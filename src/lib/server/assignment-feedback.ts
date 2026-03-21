import { ApiError } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import type { AssignmentFeedbackEntry, AssignmentFeedbackEntryKind } from '@/types'

export async function loadAssignmentFeedbackEntries(
  assignmentId: string,
  studentId: string,
): Promise<AssignmentFeedbackEntry[]> {
  const supabase = getServiceRoleClient()
  const { data, error } = await supabase
    .from('assignment_feedback_entries')
    .select('*')
    .eq('assignment_id', assignmentId)
    .eq('student_id', studentId)
    .order('returned_at', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    throw new ApiError(500, 'Failed to load assignment feedback history')
  }

  return (data || []) as AssignmentFeedbackEntry[]
}

export async function appendAssignmentFeedbackEntry(opts: {
  assignmentId: string
  studentId: string
  createdBy: string
  entryKind: AssignmentFeedbackEntryKind
  authorType?: 'teacher' | 'ai'
  body: string
  returnedAt?: string
}): Promise<AssignmentFeedbackEntry> {
  const supabase = getServiceRoleClient()
  const { data, error } = await supabase
    .from('assignment_feedback_entries')
    .insert({
      assignment_id: opts.assignmentId,
      student_id: opts.studentId,
      entry_kind: opts.entryKind,
      author_type: opts.authorType ?? 'teacher',
      body: opts.body,
      returned_at: opts.returnedAt ?? new Date().toISOString(),
      created_by: opts.createdBy,
    })
    .select('*')
    .single()

  if (error || !data) {
    throw new ApiError(500, 'Failed to save returned feedback')
  }

  return data as AssignmentFeedbackEntry
}

export function getLatestReturnedFeedbackBody(entries: AssignmentFeedbackEntry[]): string | null {
  if (!entries.length) return null
  return entries[entries.length - 1]?.body ?? null
}

