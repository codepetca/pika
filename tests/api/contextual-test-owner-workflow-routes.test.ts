import { NextRequest, NextResponse } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requireAuth, requireRole } from '@/lib/auth'
import { PATCH } from '@/app/api/teacher/tests/[id]/route'
import { POST as selectedAccess } from '@/app/api/teacher/tests/[id]/student-access/route'
import { POST as reserve, PATCH as finalize, DELETE as cancel } from '@/app/api/teacher/tests/[id]/documents/upload/route'
import { POST as sync } from '@/app/api/teacher/tests/[id]/documents/[docId]/sync/route'
import { GET as file } from '@/app/api/teacher/tests/[id]/documents/[docId]/file/route'
import { GET as snapshot } from '@/app/api/teacher/tests/[id]/documents/[docId]/snapshot/route'
import * as workflow from '@/lib/server/contextual-test-owner-materials'
import { assertTeacherOwnsTest } from '@/lib/server/tests'

const actor = '11111111-1111-4111-8111-111111111111'
const testId = '33333333-3333-4333-8333-333333333333'
const documentId = '44444444-4444-4444-8444-444444444444'
const objectId = '55555555-5555-4555-8555-555555555555'
vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => ({})) }))
vi.mock('@/lib/server/tests', async () => ({ ...await vi.importActual('@/lib/server/tests'), assertTeacherOwnsTest: vi.fn() }))
vi.mock('@/lib/server/contextual-test-owner-materials', () => ({
  patchContextualTestOwnerMetadata: vi.fn(), updateContextualTestOwnerStudentAccess: vi.fn(), reserveContextualTestOwnerDocument: vi.fn(),
  finalizeContextualTestOwnerDocument: vi.fn(), cancelContextualTestOwnerDocument: vi.fn(), syncContextualTestOwnerDocument: vi.fn(), readContextualTestOwnerDocument: vi.fn(),
}))
const ctx = { params: Promise.resolve({ id: testId, docId: documentId }) }
const req = (method: string, body?: unknown) => new NextRequest('http://localhost/api/teacher/tests', { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) })
const admitted = () => vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actor] }))
describe('complete dormant owner Test authoring and selected access route group', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.unstubAllEnvs(); delete process.env.PIKA_CLASSROOM_EXPERIENCE_ADMISSION
    vi.mocked(requireAuth).mockResolvedValue({ id: actor, role: 'student', email: 'owner@example.test' })
    vi.mocked(requireRole).mockResolvedValue({ id: actor, role: 'teacher', email: 'owner@example.test' })
    vi.mocked(assertTeacherOwnsTest).mockResolvedValue({ ok: false, status: 403, error: 'legacy' })
    vi.mocked(workflow.patchContextualTestOwnerMetadata).mockResolvedValue({ test: { id: testId } } as never)
    vi.mocked(workflow.updateContextualTestOwnerStudentAccess).mockResolvedValue({ updated_count: 1, skipped_count: 0, state: 'open', locked_count: 0, unlocked_count: 0 })
    vi.mocked(workflow.reserveContextualTestOwnerDocument).mockResolvedValue({ managed_object_id: objectId } as never)
    vi.mocked(workflow.finalizeContextualTestOwnerDocument).mockResolvedValue({ managed_object_id: objectId } as never)
    vi.mocked(workflow.cancelContextualTestOwnerDocument).mockResolvedValue(undefined)
    vi.mocked(workflow.syncContextualTestOwnerDocument).mockResolvedValue({ test: { id: testId } } as never)
    vi.mocked(workflow.readContextualTestOwnerDocument).mockResolvedValue(new NextResponse('readback'))
  })
  afterEach(() => vi.unstubAllEnvs())
  const cases = [
    ['metadata', PATCH, 'PATCH', { title: 'Renamed' }, 200],
    ['access', selectedAccess, 'POST', { state: 'open', student_ids: [documentId] }, 200],
    ['reservation', reserve, 'POST', { document_id: documentId, file_name: 'a.pdf', content_type: 'application/pdf', byte_size: 20 }, 200],
    ['finalization', finalize, 'PATCH', { document_id: documentId, managed_object_id: objectId }, 200],
    ['cancellation', cancel, 'DELETE', { managed_object_id: objectId }, 204],
    ['sync', sync, 'POST', undefined, 200], ['file', file, 'GET', undefined, 200], ['snapshot', snapshot, 'GET', undefined, 200],
  ] as const
  it.each(cases)('uses shared relationship authority for %s and both historical account roles', async (_label, handler, method, body, status) => {
    admitted()
    for (const role of ['student', 'teacher'] as const) {
      vi.mocked(requireAuth).mockResolvedValue({ id: actor, role, email: 'owner@example.test' })
      const response = await handler(req(method, body), ctx)
      expect(response.status).toBe(status)
    }
    expect(requireRole).not.toHaveBeenCalled(); expect(assertTeacherOwnsTest).not.toHaveBeenCalled()
  })
  it.each(cases)('rejects malformed admission before parameters/body/discovery for %s', async (_label, handler, method, body) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{}')
    const response = await handler(req(method, body), { params: new Promise(() => {}) })
    expect(response.status).toBe(503); expect(requireRole).not.toHaveBeenCalled(); expect(assertTeacherOwnsTest).not.toHaveBeenCalled()
    for (const fn of Object.values(workflow)) expect(fn).not.toHaveBeenCalled()
  })
  it.each([undefined, JSON.stringify({ version: 1, admittedUserIds: [] })])('retains unmatched metadata/access legacy dispatch %#', async config => {
    if (config) vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', config)
    expect((await PATCH(req('PATCH', { title: 'Renamed' }), ctx)).status).toBe(403)
    expect((await selectedAccess(req('POST', { state: 'open', student_ids: [documentId] }), ctx)).status).toBe(403)
    expect(requireRole).toHaveBeenCalledTimes(2); expect(workflow.patchContextualTestOwnerMetadata).not.toHaveBeenCalled()
  })
  it('validates current owner transport before the server coordinator', async () => {
    admitted()
    expect((await PATCH(req('PATCH', { status: 'closed', draft_version: 1 }), ctx)).status).toBe(400)
    expect((await selectedAccess(req('POST', { state: 'open', student_ids: Array(101).fill(documentId) }), ctx)).status).toBe(400)
    expect((await cancel(req('DELETE', { managed_object_id: objectId }), { params: Promise.resolve({ id: 'bad' }) })).status).toBe(400)
    expect(workflow.patchContextualTestOwnerMetadata).not.toHaveBeenCalled(); expect(workflow.cancelContextualTestOwnerDocument).not.toHaveBeenCalled()
  })
  it('bounds pending parameters under the same request deadline', async () => {
    admitted(); vi.useFakeTimers()
    try {
      const request = req('PATCH', { title: 'Renamed' }); const reader = vi.spyOn(request.body!, 'getReader')
      const pending = PATCH(request, { params: new Promise(() => {}) })
      await vi.advanceTimersByTimeAsync(30000)
      expect((await pending).status).toBe(503); expect(reader).not.toHaveBeenCalled()
      expect(workflow.patchContextualTestOwnerMetadata).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
})
