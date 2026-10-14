import { isDeepStrictEqual } from 'node:util'
import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { ApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { normalizeTestDocuments } from '@/lib/test-documents'
import { isClassroomExperienceAdmissionConfigured, resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'
import { createContextualTestOwnerWorkflow } from '@/lib/server/contextual-test-owner-workflow'
import { testUnpublicationBodySchema, testUnpublicationParamsSchema, testUnpublicationResultSchema } from '@/lib/validations/test-unpublication'
import { readContextualTestOwnerBody, resolveContextualTestOwnerParams, TEST_OWNER_WORKFLOW_DEADLINE_MS } from '@/lib/validations/contextual-test-owner-workflow'

const unavailable = () => new ApiError(503, 'Unable to verify Test return to draft')
const resultSchema = testUnpublicationResultSchema.omit({ test: true })
const messages: Record<number, string> = {
  400: 'Invalid Test return request', 403: 'Forbidden', 404: 'Test not found',
  409: 'Test cannot return to draft', 503: 'Unable to verify Test return to draft',
}

/** Admission selects the boundary; SQL proves current ownership independently
 * of account role. An admitted failure never falls back or retries a write. */
export async function handleContextualTestOwnerUnpublicationRequest(request: Request, params: Promise<unknown>): Promise<NextResponse | null> {
  if (!isClassroomExperienceAdmissionConfigured()) return null
  const actor = await requireAuth()
  if (resolveClassroomExperienceAdmission(actor).status !== 'admitted') return null
  const deadline = Date.now() + TEST_OWNER_WORKFLOW_DEADLINE_MS
  try {
    const { id } = testUnpublicationParamsSchema.parse(await resolveContextualTestOwnerParams(request, params, deadline))
    const payload = testUnpublicationBodySchema.parse(await readContextualTestOwnerBody(request, deadline))
    const flow = createContextualTestOwnerWorkflow({ supabase: getServiceRoleClient(), actorId: actor.id, testId: id, deadline, signal: request.signal })
    const source = await flow.inspect()
    const witness = await flow.run('unpublish', payload)
    const result = resultSchema.safeParse(witness.result)
    if (!result.success) throw unavailable()
    const parsed = testUnpublicationResultSchema.safeParse({ test: witness.test, draft_version: result.data.draft_version })
    if (!parsed.success || parsed.data.test.id !== id || parsed.data.test.classroom_id !== source.classroom_id
      || parsed.data.test.questions_locked_at !== null || source.questions_locked_at !== null
      || !['closed', 'draft'].includes(source.status)) throw unavailable()
    const { status: _beforeStatus, updated_at: _beforeUpdated, ...before } = source
    const { status: _afterStatus, updated_at: _afterUpdated, ...after } = parsed.data.test
    if (!isDeepStrictEqual(before, after) || (source.status === 'draft' && !isDeepStrictEqual(source, parsed.data.test))
      || request.signal.aborted || Date.now() >= deadline) throw unavailable()
    return NextResponse.json({ test: { ...parsed.data.test, documents: normalizeTestDocuments(parsed.data.test.documents), assessment_type: 'test' }, draft_version: parsed.data.draft_version })
  } catch (error) {
    if (error instanceof ApiError) throw new ApiError(messages[error.statusCode] ? error.statusCode : 503, messages[error.statusCode] ?? messages[503])
    if (error instanceof ZodError) throw error
    throw unavailable()
  }
}
