type SupabaseLike = any

type FinalizeResult =
  | {
      ok: true
      finalized_attempts: number
      inserted_responses: number
    }
  | {
      ok: false
      status: number
      error: string
    }

export async function finalizeUnsubmittedTestAttemptsOnClose(
  supabase: SupabaseLike,
  testId: string,
  options?: {
    studentIds?: string[]
    closedBy?: string | null
  }
): Promise<FinalizeResult> {
  const studentIdsFilter = Array.from(new Set((options?.studentIds || []).filter(Boolean)))
  const { data, error } = await supabase.rpc('finalize_test_attempts_for_grading_atomic', {
    p_test_id: testId,
    p_student_ids: studentIdsFilter.length > 0 ? studentIdsFilter : null,
    p_closed_by: options?.closedBy || null,
  })

  if (error) {
    if (isMissingFinalizeRpcError(error)) {
      return {
        ok: false,
        status: 400,
        error: 'Finalizing test attempts requires migrations 061-063 to be applied',
      }
    }
    console.error('Error finalizing test attempts for grading:', error)
    return { ok: false, status: 500, error: 'Failed to finalize test submissions' }
  }

  return {
    ok: true,
    finalized_attempts: Number(data?.finalized_attempts ?? 0),
    inserted_responses: Number(data?.inserted_responses ?? 0),
  }
}

function isMissingFinalizeRpcError(error: {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
} | null | undefined): boolean {
  if (!error) return false
  const combined = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase()
  return (
    error.code === '42883' ||
    error.code === 'PGRST202' ||
    error.code === 'PGRST204' ||
    error.code === '42703' ||
    combined.includes('finalize_test_attempts_for_grading_atomic') ||
    combined.includes('closed_for_grading')
  )
}
