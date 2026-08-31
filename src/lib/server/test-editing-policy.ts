import { z } from 'zod'
import { ApiError } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import type { TestEditingPolicy } from '@/lib/test-editing-policy'

const lockRowSchema = z.object({ questions_locked_at: z.string().nullable() })

/** Fresh advisory policy for the editor; the transaction enforces the boundary. */
export async function getTestEditingPolicy(testId: string): Promise<TestEditingPolicy> {
  const { data, error } = await getServiceRoleClient()
    .from('tests').select('questions_locked_at').eq('id', testId).single()
  if (error) {
    if (error.code === '42703' || error.code === 'PGRST204') {
      throw new ApiError(503, 'Test editing requires migration 142 to be applied')
    }
    throw new ApiError(500, 'Failed to check test editing permissions')
  }
  const parsed = lockRowSchema.safeParse(data)
  if (!parsed.success) throw new ApiError(503, 'Test editing policy is unavailable')
  return { structureLocked: parsed.data.questions_locked_at !== null }
}
