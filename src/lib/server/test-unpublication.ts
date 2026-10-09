import { ApiError } from '@/lib/api-error'
import { normalizeTestDocuments } from '@/lib/test-documents'
import { getServiceRoleClient } from '@/lib/supabase'
import { testUnpublicationResultSchema } from '@/lib/validations/test-unpublication'

const unavailable = () => new ApiError(503, 'Unable to verify Test return to draft')

/** SQL owns the locked eligibility decision and source-to-draft synchronization. */
export async function returnTestToDraft(teacherId: string, testId: string, classroomId: string) {
  let result: Awaited<ReturnType<ReturnType<typeof getServiceRoleClient>['rpc']>>
  try {
    result = await getServiceRoleClient().rpc('return_test_to_draft_atomic', {
      p_teacher_id: teacherId,
      p_test_id: testId,
    })
  } catch {
    throw unavailable()
  }
  if (result.error) {
    if (result.data !== null) throw unavailable()
    if (result.error.code === 'PT400') throw new ApiError(400, 'Invalid Test return request')
    if (result.error.code === 'PT403') throw new ApiError(403, 'Forbidden')
    if (result.error.code === 'PT404') throw new ApiError(404, 'Test not found')
    if (['PT409', '55P03', '40P01', '40001'].includes(result.error.code)) {
      throw new ApiError(409, 'Test cannot return to draft')
    }
    throw unavailable()
  }
  if (result.status !== undefined && (result.status < 200 || result.status >= 300)) throw unavailable()
  const parsed = testUnpublicationResultSchema.safeParse(result.data)
  if (!parsed.success || parsed.data.test.id !== testId || parsed.data.test.classroom_id !== classroomId) throw unavailable()
  return {
    test: { ...parsed.data.test, documents: normalizeTestDocuments(parsed.data.test.documents), assessment_type: 'test' as const },
    draft_version: parsed.data.draft_version,
  }
}
