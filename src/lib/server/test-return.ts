import { z } from 'zod'
import { getServiceRoleClient } from '@/lib/supabase'
import { logServerError } from '@/lib/server/diagnostics'

const returnCountsSchema = z.object({
  returned_count: z.number().int().nonnegative(),
  already_returned_count: z.number().int().nonnegative(),
  skipped_count: z.number().int().nonnegative(),
  test_closed: z.literal(false),
})

// Eligibility and disclosure must share the same transaction. No route preflight
// may authorize Return after a concurrent reopen, grade clear or ownership change.
export async function returnStudentTestAttempts(input: {
  testId: string
  teacherId: string
  studentIds: string[]
}): Promise<
  | { ok: true; counts: z.infer<typeof returnCountsSchema> }
  | { ok: false; status: number; error: string }
> {
  const { data, error } = await getServiceRoleClient().rpc('return_test_attempts_checked_atomic', {
    p_test_id: input.testId,
    p_student_ids: input.studentIds,
    p_returned_by: input.teacherId,
  })
  if (error) {
    if (error.code === '42501') return { ok: false, status: 403, error: error.message }
    if (error.code === 'P0002' || error.code === '22P02') return { ok: false, status: 404, error: 'Test not found' }
    if (error.code === '22023') return { ok: false, status: 400, error: error.message }
    if (error.code === 'PT409' || error.code === '40001') return { ok: false, status: 409, error: error.message }
    if (error.code === 'PGRST202' || error.code === '42883') {
      return { ok: false, status: 503, error: 'Test lifecycle migration 244 is required' }
    }
    logServerError('api.unexpected', error)
    return { ok: false, status: 500, error: 'Failed to return test work' }
  }
  const parsed = returnCountsSchema.safeParse(data)
  if (!parsed.success || parsed.data.returned_count + parsed.data.already_returned_count + parsed.data.skipped_count !== input.studentIds.length) {
    logServerError('api.unexpected', parsed.success ? new Error('Invalid return counts') : parsed.error)
    return { ok: false, status: 500, error: 'Failed to return test work' }
  }
  return { ok: true, counts: parsed.data }
}
