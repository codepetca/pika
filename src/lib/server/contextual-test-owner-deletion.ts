import { isDeepStrictEqual } from 'node:util'
import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { ApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { isClassroomExperienceAdmissionConfigured, resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'
import { createContextualTestOwnerWorkflow } from '@/lib/server/contextual-test-owner-workflow'
import { testDeletionParamsSchema, testDeletionResultSchema } from '@/lib/validations/test-deletion'
import { resolveContextualTestOwnerParams, TEST_OWNER_WORKFLOW_DEADLINE_MS } from '@/lib/validations/contextual-test-owner-workflow'

const unavailable = () => new ApiError(503, 'Unable to verify Test deletion')
const messages: Record<number, string> = {
  400: 'Invalid Test deletion request', 403: 'Forbidden', 404: 'Test not found',
  409: 'Test changed; reload and retry', 503: 'Unable to verify Test deletion',
}

/** Bodyless whole-Test deletion. Admission selects the boundary; the existing
 * transaction proves current ownership and preserves the legacy deletion policy. */
export async function handleContextualTestOwnerDeletionRequest(request: Request, params: Promise<unknown>): Promise<NextResponse | null> {
  if (!isClassroomExperienceAdmissionConfigured()) return null
  const actor = await requireAuth()
  if (resolveClassroomExperienceAdmission(actor).status !== 'admitted') return null
  const deadline = Date.now() + TEST_OWNER_WORKFLOW_DEADLINE_MS
  try {
    const { id } = testDeletionParamsSchema.parse(await resolveContextualTestOwnerParams(request, params, deadline))
    const flow = createContextualTestOwnerWorkflow({ supabase: getServiceRoleClient(), actorId: actor.id, testId: id, deadline, signal: request.signal })
    const source = await flow.inspect()
    const witness = await flow.run('delete', {})
    const result = testDeletionResultSchema.safeParse(witness.result)
    if (!result.success || witness.operation !== 'delete' || witness.test_absent !== true
      || !isDeepStrictEqual(witness.test, source) || request.signal.aborted || Date.now() >= deadline) throw unavailable()
    return NextResponse.json({ success: result.data.deleted, responses_count: result.data.responses_count })
  } catch (error) {
    if (error instanceof ApiError) throw new ApiError(messages[error.statusCode] ? error.statusCode : 503, messages[error.statusCode] ?? messages[503])
    if (error instanceof ZodError) throw error
    throw unavailable()
  }
}
