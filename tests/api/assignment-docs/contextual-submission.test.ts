import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

import { POST as submit } from '@/app/api/assignment-docs/[id]/submit/route'
import { POST as unsubmit } from '@/app/api/assignment-docs/[id]/unsubmit/route'
import { requireAuth } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import {
  submitAssignmentDocAtomic,
  unsubmitAssignmentDocAtomic,
} from '@/lib/server/assignment-doc-submissions'
import {
  submitContextualAssignmentDoc,
  unsubmitContextualAssignmentDoc,
} from '@/lib/server/contextual-assignment-doc-submission'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/classrooms', () => ({ assertStudentCanAccessClassroom: vi.fn() }))
vi.mock('@/lib/server/assignment-doc-submissions', () => ({
  submitAssignmentDocAtomic: vi.fn(),
  unsubmitAssignmentDocAtomic: vi.fn(),
}))
vi.mock('@/lib/server/contextual-assignment-doc-submission', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/server/contextual-assignment-doc-submission')>(),
  submitContextualAssignmentDoc: vi.fn(),
  unsubmitContextualAssignmentDoc: vi.fn(),
}))
vi.mock('@/lib/server/assignment-submission-artifacts', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/server/assignment-submission-artifacts')>(),
  loadAssignmentSubmissionRequirements: vi.fn(async () => []),
  loadAssignmentSubmissionArtifactsForDoc: vi.fn(async () => []),
}))

const actorId = '11111111-1111-4111-8111-111111111111'
const assignmentId = '22222222-2222-4222-8222-222222222222'
const classroomId = '33333333-3333-4333-8333-333333333333'
const docId = '44444444-4444-4444-8444-444444444444'
const revision = '2026-09-20T12:00:00.000Z'
const content = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Submitted' }] }],
}
const teacher = { id: actorId, role: 'teacher', email: 'member@example.com' }

function assignmentDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: docId,
    assignment_id: assignmentId,
    student_id: actorId,
    content,
    is_submitted: true,
    submitted_at: revision,
    updated_at: revision,
    returned_at: null,
    teacher_cleared_at: null,
    teacher_feedback_draft: 'private',
    ai_feedback_suggestion: 'private',
    authenticity_score: 99,
    ...overrides,
  }
}

function preflightDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: docId,
    assignment_id: assignmentId,
    student_id: actorId,
    content,
    is_submitted: false,
    submitted_at: null,
    updated_at: revision,
    returned_at: null,
    teacher_cleared_at: null,
    ...overrides,
  }
}

function contextualClient(docRows: unknown = [preflightDoc()]) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'assignments') {
        const query: any = {
          eq: vi.fn(() => query),
          limit: vi.fn().mockResolvedValue({
            data: [{ id: assignmentId, classroom_id: classroomId, due_at: null }],
            error: null,
          }),
        }
        return { select: vi.fn(() => query) }
      }
      if (table === 'assignment_docs') {
        const query: any = {
          eq: vi.fn(() => query),
          limit: vi.fn().mockResolvedValue({ data: docRows, error: null }),
        }
        return {
          select: vi.fn(() => query),
          update: vi.fn(() => query),
        }
      }
      if (table === 'assignment_doc_history') {
        const query: any = {
          eq: vi.fn(() => query),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        }
        return { select: vi.fn(() => query) }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
    rpc: vi.fn(),
  }
}

function submitRequest() {
  return new NextRequest(`http://localhost/api/assignment-docs/${assignmentId}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, expected_updated_at: revision }),
  })
}

describe('contextual assignment submit and unsubmit routes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DOC_SUBMISSION_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DOC_SUBMISSION_ACCESS_PAIRS', JSON.stringify([{
      userId: actorId,
      assignmentId,
    }]))
    vi.mocked(requireAuth).mockResolvedValue(teacher as any)
    vi.mocked(submitContextualAssignmentDoc).mockResolvedValue({
      ok: true,
      doc: assignmentDoc() as any,
      historyEntry: null,
      classroomId,
      idempotent: false,
    })
    vi.mocked(unsubmitContextualAssignmentDoc).mockResolvedValue({
      ok: true,
      doc: assignmentDoc({ is_submitted: false, submitted_at: null }) as any,
      historyEntry: null,
      classroomId,
    })
  })

  afterEach(() => vi.unstubAllEnvs())

  it('submits the matched teacher-valued member without legacy role authorization', async () => {
    const client = contextualClient()
    vi.mocked(getServiceRoleClient).mockReturnValue(client as never)

    const response = await submit(submitRequest(), {
      params: Promise.resolve({ id: assignmentId }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.doc).toMatchObject({
      id: docId,
      student_id: actorId,
      teacher_feedback_draft: null,
      authenticity_score: null,
    })
    expect(submitContextualAssignmentDoc).toHaveBeenCalledWith(expect.objectContaining({
      actorId,
      assignmentId,
      content,
      expectedUpdatedAt: revision,
    }))
    expect(submitAssignmentDocAtomic).not.toHaveBeenCalled()
    expect(assertStudentCanAccessClassroom).not.toHaveBeenCalled()
  })

  it('fails closed on substituted document preflight evidence', async () => {
    const client = contextualClient([preflightDoc({ student_id: docId })])
    vi.mocked(getServiceRoleClient).mockReturnValue(client as never)

    const response = await submit(submitRequest(), {
      params: Promise.resolve({ id: assignmentId }),
    })
    expect(response.status).toBe(503)
    expect(submitContextualAssignmentDoc).not.toHaveBeenCalled()
  })

  it('unsubmits the matched teacher-valued member without legacy preflights', async () => {
    const client = contextualClient()
    vi.mocked(getServiceRoleClient).mockReturnValue(client as never)

    const response = await unsubmit(new NextRequest(
      `http://localhost/api/assignment-docs/${assignmentId}/unsubmit`,
      { method: 'POST' },
    ), { params: Promise.resolve({ id: assignmentId }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.doc).toMatchObject({ is_submitted: false, teacher_feedback_draft: null })
    expect(unsubmitContextualAssignmentDoc).toHaveBeenCalledWith(expect.objectContaining({
      actorId,
      assignmentId,
    }))
    expect(unsubmitAssignmentDocAtomic).not.toHaveBeenCalled()
    expect(client.from).not.toHaveBeenCalled()
    expect(assertStudentCanAccessClassroom).not.toHaveBeenCalled()
  })

  it('rejects an unmatched teacher-valued account before creating a service client', async () => {
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DOC_SUBMISSION_ACCESS_PAIRS', '[]')
    const response = await submit(submitRequest(), {
      params: Promise.resolve({ id: assignmentId }),
    })
    expect(response.status).toBe(403)
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })
})
