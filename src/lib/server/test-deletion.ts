import { z } from 'zod'
import { ApiError } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'

const deleteTestResultSchema = z.object({
  deleted: z.literal(true),
  responses_count: z.number().int().nonnegative(),
}).strict()

type DatabaseError = { code?: string; message?: string }

export async function deleteTeacherTestAtomic(input: {
  testId: string
  teacherId: string
}): Promise<{ deleted: true; responsesCount: number }> {
  const supabase = getServiceRoleClient()
  const { data, error } = await supabase.rpc('delete_test_atomic', {
    p_test_id: input.testId,
    p_teacher_id: input.teacherId,
  })

  if (error) {
    const databaseError = error as DatabaseError
    if (databaseError.code === 'P0002') throw new ApiError(404, databaseError.message || 'Test not found')
    if (databaseError.code === '42501') throw new ApiError(403, databaseError.message || 'Test deletion is not allowed')
    if (databaseError.code === '22023' || databaseError.code === '22P02') {
      throw new ApiError(400, databaseError.message || 'Test deletion payload is invalid')
    }
    throw new Error('Failed to delete test')
  }

  const parsed = deleteTestResultSchema.safeParse(data)
  if (!parsed.success) throw new Error('Invalid test deletion result')
  return { deleted: true, responsesCount: parsed.data.responses_count }
}
