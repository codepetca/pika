import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

import { PATCH } from '@/app/api/assignment-docs/[id]/route'
import { requireAuth } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { saveAssignmentDocAtomic } from '@/lib/server/assignment-doc-submissions'
import { saveContextualAssignmentDoc } from '@/lib/server/contextual-assignment-doc-save'

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/classrooms', () => ({ assertStudentCanAccessClassroom: vi.fn() }))
vi.mock('@/lib/server/assignment-doc-submissions', () => ({ saveAssignmentDocAtomic: vi.fn() }))
vi.mock('@/lib/server/contextual-assignment-doc-save', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/server/contextual-assignment-doc-save')>(),
  saveContextualAssignmentDoc: vi.fn(),
}))

const actorId = '11111111-1111-4111-8111-111111111111'
const assignmentId = '22222222-2222-4222-8222-222222222222'
const docId = '33333333-3333-4333-8333-333333333333'
const saveSessionId = '44444444-4444-4444-8444-444444444444'
const metricSessionId = '55555555-5555-4555-8555-555555555555'
const revision = '2026-09-19T12:00:00.000Z'
const beforeContent = { type: 'doc', content: [] }
const content = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Saved' }] }],
}
const actor = { id: actorId, role: 'teacher', email: 'member@example.com' }

function request() {
  return new NextRequest(`http://localhost/api/assignment-docs/${assignmentId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      content,
      expected_updated_at: revision,
      save_session_id: saveSessionId,
      save_sequence: 2,
      metric_session_id: metricSessionId,
    }),
  })
}

function clientWithEvidence(evidence: unknown, error: unknown = null) {
  const query: any = {
    eq: vi.fn(() => query),
    limit: vi.fn().mockResolvedValue({ data: evidence, error }),
  }
  return {
    from: vi.fn((table: string) => {
      if (table !== 'assignment_docs') throw new Error(`Unexpected legacy table: ${table}`)
      return { select: vi.fn(() => query) }
    }),
    rpc: vi.fn(),
  }
}

describe('contextual PATCH /api/assignment-docs/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DOC_SAVE_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DOC_SAVE_ACCESS_PAIRS', JSON.stringify([{
      userId: actorId,
      assignmentId,
    }]))
    vi.mocked(requireAuth).mockResolvedValue(actor as any)
    vi.mocked(saveContextualAssignmentDoc).mockResolvedValue({
      ok: true,
      doc: {
        id: docId,
        assignment_id: assignmentId,
        student_id: actorId,
        content,
        teacher_feedback_draft: 'private',
        authenticity_score: 99,
      } as any,
      historyEntry: null,
    })
  })

  afterEach(() => vi.unstubAllEnvs())

  it('saves the authenticated member document regardless of legacy role', async () => {
    const client = clientWithEvidence([{
      id: docId,
      assignment_id: assignmentId,
      student_id: actorId,
      is_submitted: false,
      content: beforeContent,
      updated_at: revision,
    }])
    vi.mocked(getServiceRoleClient).mockReturnValue(client as never)

    const response = await PATCH(request(), { params: Promise.resolve({ id: assignmentId }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.doc).toMatchObject({
      id: docId,
      assignment_id: assignmentId,
      student_id: actorId,
      teacher_feedback_draft: null,
      authenticity_score: null,
    })
    expect(saveContextualAssignmentDoc).toHaveBeenCalledWith(expect.objectContaining({
      actorId,
      assignmentId,
      previousContent: beforeContent,
      content,
      expectedUpdatedAt: revision,
      saveSessionId,
      saveSequence: 2,
      metricSessionId,
    }))
    expect(saveAssignmentDocAtomic).not.toHaveBeenCalled()
    expect(client.from).not.toHaveBeenCalledWith('assignments')
    expect(client.from).not.toHaveBeenCalledWith('classroom_enrollments')
  })

  it('allows the transaction to create a missing document', async () => {
    const client = clientWithEvidence([])
    vi.mocked(getServiceRoleClient).mockReturnValue(client as never)

    const response = await PATCH(request(), { params: Promise.resolve({ id: assignmentId }) })
    expect(response.status).toBe(200)
    expect(saveContextualAssignmentDoc).toHaveBeenCalledWith(expect.objectContaining({
      previousContent: { type: 'doc', content: [] },
    }))
  })

  it.each([
    ['query failure', [], { code: '08006' }],
    ['missing evidence shape', null, null],
    ['duplicate rows', [
      { id: docId, assignment_id: assignmentId, student_id: actorId },
      { id: docId, assignment_id: assignmentId, student_id: actorId },
    ], null],
    ['substituted actor', [{ id: docId, assignment_id: assignmentId, student_id: docId }], null],
    ['substituted assignment', [{ id: docId, assignment_id: docId, student_id: actorId }], null],
  ])('fails closed on %s before the save RPC', async (_label, evidence, error) => {
    const client = clientWithEvidence(evidence, error)
    vi.mocked(getServiceRoleClient).mockReturnValue(client as never)

    const response = await PATCH(request(), { params: Promise.resolve({ id: assignmentId }) })
    expect(response.status).toBe(503)
    expect(saveContextualAssignmentDoc).not.toHaveBeenCalled()
  })

  it('keeps submitted documents immutable before the transaction', async () => {
    const client = clientWithEvidence([{
      id: docId,
      assignment_id: assignmentId,
      student_id: actorId,
      is_submitted: true,
      content: beforeContent,
      updated_at: revision,
    }])
    vi.mocked(getServiceRoleClient).mockReturnValue(client as never)

    const response = await PATCH(request(), { params: Promise.resolve({ id: assignmentId }) })
    expect(response.status).toBe(403)
    expect(saveContextualAssignmentDoc).not.toHaveBeenCalled()
  })

  it('rejects an unmatched teacher-valued account before creating a service client', async () => {
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DOC_SAVE_ACCESS_PAIRS', '[]')
    const response = await PATCH(request(), { params: Promise.resolve({ id: assignmentId }) })
    expect(response.status).toBe(403)
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })
})
