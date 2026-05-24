export const MAX_TEST_WORK_DELETIONS_PER_REQUEST = 100

export interface TestWorkDeletionResult {
  requested_count: number
  deleted_student_count: number
  deleted_attempts: number
  deleted_responses: number
  deleted_focus_events: number
  deleted_ai_grading_items: number
}

export function normalizeStudentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
    )
  )
}

export function getKnownTestWorkDeletionRpcError(error: {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
} | null | undefined): { status: number; message: string } | null {
  if (!error) return null

  const combined = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase()

  if (
    error.code === '42883' ||
    error.code === 'PGRST202' ||
    combined.includes('delete_student_test_attempts_atomic')
  ) {
    return {
      status: 400,
      message: 'Deleting selected student test work requires migration 072 to be applied',
    }
  }

  return null
}

export async function deleteStudentTestAttemptsAtomic({
  supabase,
  testId,
  studentIds,
}: {
  supabase: any
  testId: string
  studentIds: string[]
}) {
  return supabase.rpc('delete_student_test_attempts_atomic', {
    p_test_id: testId,
    p_student_ids: studentIds,
  })
}
