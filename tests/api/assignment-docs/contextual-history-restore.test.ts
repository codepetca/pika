import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

import { GET as history } from '@/app/api/assignment-docs/[id]/history/route'
import { POST as restore } from '@/app/api/assignment-docs/[id]/restore/route'
import { ApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { saveAssignmentDocAtomic } from '@/lib/server/assignment-doc-submissions'
import {
  getContextualAssignmentDocHistory,
  restoreContextualAssignmentDoc,
} from '@/lib/server/contextual-assignment-doc-history'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/classrooms', () => ({ assertStudentCanAccessClassroom: vi.fn() }))
vi.mock('@/lib/server/assignment-doc-submissions', () => ({ saveAssignmentDocAtomic: vi.fn() }))
vi.mock('@/lib/server/contextual-assignment-doc-history', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/server/contextual-assignment-doc-history')>(),
  getContextualAssignmentDocHistory: vi.fn(),
  restoreContextualAssignmentDoc: vi.fn(),
}))

const actorId = '11111111-1111-4111-8111-111111111111'
const assignmentId = '22222222-2222-4222-8222-222222222222'
const classroomId = '33333333-3333-4333-8333-333333333333'
const docId = '44444444-4444-4444-8444-444444444444'
const olderHistoryId = '55555555-5555-4555-8555-555555555555'
const newerHistoryId = '66666666-6666-4666-8666-666666666666'
const revision = '2026-09-20T12:00:00.000Z'
const beforeContent = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Before' }] }],
}
const restoredContent = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Restored' }] }],
}
const teacher = { id: actorId, role: 'teacher', email: 'member@example.com' }

function historyEntry(id: string, snapshot: typeof restoredContent | null, createdAt: string) {
  return {
    id,
    assignment_doc_id: docId,
    patch: null,
    snapshot,
    word_count: 1,
    char_count: 8,
    paste_word_count: 0,
    keystroke_count: 0,
    trigger: 'baseline' as const,
    created_at: createdAt,
  }
}

function memberEvidence() {
  return {
    accessMode: 'member' as const,
    classroomId,
    subjectId: actorId,
    doc: {
      id: docId,
      assignment_id: assignmentId,
      student_id: actorId,
      content: beforeContent,
      is_submitted: false,
      updated_at: revision,
    },
    history: [
      historyEntry(olderHistoryId, restoredContent, '2026-09-20T11:00:00.000Z'),
      historyEntry(newerHistoryId, null, revision),
    ],
  }
}

describe('contextual assignment history and restore routes', () => {
  const client = {
    from: vi.fn(() => { throw new Error('Legacy query must not run') }),
    rpc: vi.fn(),
  }

  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DOC_HISTORY_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DOC_HISTORY_ACCESS_PAIRS', JSON.stringify([{
      userId: actorId,
      assignmentId,
    }]))
    vi.mocked(requireAuth).mockResolvedValue(teacher as any)
    vi.mocked(getServiceRoleClient).mockReturnValue(client as never)
    vi.mocked(getContextualAssignmentDocHistory).mockResolvedValue(memberEvidence() as any)
    vi.mocked(restoreContextualAssignmentDoc).mockResolvedValue({
      ok: true,
      doc: {
        id: docId,
        assignment_id: assignmentId,
        student_id: actorId,
        content: restoredContent,
        is_submitted: false,
        teacher_feedback_draft: 'private',
        authenticity_score: 99,
      } as any,
      historyEntry: null,
      classroomId,
    })
  })

  afterEach(() => vi.unstubAllEnvs())

  it('returns contextual member history in the established newest-first response order', async () => {
    const response = await history(
      new NextRequest(`http://localhost/api/assignment-docs/${assignmentId}/history`),
      { params: Promise.resolve({ id: assignmentId }) },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.docId).toBe(docId)
    expect(body.history.map((entry: { id: string }) => entry.id)).toEqual([
      newerHistoryId,
      olderHistoryId,
    ])
    expect(getContextualAssignmentDocHistory).toHaveBeenCalledWith(expect.objectContaining({
      actorId,
      assignmentId,
      requestedStudentId: null,
    }))
    expect(client.from).not.toHaveBeenCalled()
  })

  it('passes owner target selection only to the locked contextual read', async () => {
    const response = await history(
      new NextRequest(
        `http://localhost/api/assignment-docs/${assignmentId}/history?student_id=${actorId}`,
      ),
      { params: Promise.resolve({ id: assignmentId }) },
    )

    expect(response.status).toBe(200)
    expect(getContextualAssignmentDocHistory).toHaveBeenCalledWith(expect.objectContaining({
      requestedStudentId: actorId,
    }))
    expect(client.from).not.toHaveBeenCalled()
  })

  it('restores a matched teacher-valued member without legacy role or service reads', async () => {
    const response = await restore(new NextRequest(
      `http://localhost/api/assignment-docs/${assignmentId}/restore`,
      {
        method: 'POST',
        body: JSON.stringify({ history_id: olderHistoryId }),
      },
    ), { params: Promise.resolve({ id: assignmentId }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.doc).toMatchObject({
      id: docId,
      student_id: actorId,
      teacher_feedback_draft: null,
      authenticity_score: null,
    })
    expect(getContextualAssignmentDocHistory).toHaveBeenCalledWith(expect.objectContaining({
      actorId,
      assignmentId,
      memberOnly: true,
    }))
    expect(restoreContextualAssignmentDoc).toHaveBeenCalledWith(expect.objectContaining({
      actorId,
      assignmentId,
      historyId: olderHistoryId,
      previousContent: beforeContent,
      content: restoredContent,
      expectedUpdatedAt: revision,
    }))
    expect(saveAssignmentDocAtomic).not.toHaveBeenCalled()
    expect(assertStudentCanAccessClassroom).not.toHaveBeenCalled()
    expect(client.from).not.toHaveBeenCalled()
  })

  it('denies a removed exact-pair member before reading history or document state', async () => {
    vi.mocked(getContextualAssignmentDocHistory).mockRejectedValue(new ApiError(403, 'Forbidden'))
    const response = await restore(new NextRequest(
      `http://localhost/api/assignment-docs/${assignmentId}/restore`,
      { method: 'POST', body: JSON.stringify({ history_id: olderHistoryId }) },
    ), { params: Promise.resolve({ id: assignmentId }) })

    expect(response.status).toBe(403)
    expect(restoreContextualAssignmentDoc).not.toHaveBeenCalled()
    expect(client.from).not.toHaveBeenCalled()
  })

  it('does not invoke the restore transaction for an absent target entry', async () => {
    const response = await restore(new NextRequest(
      `http://localhost/api/assignment-docs/${assignmentId}/restore`,
      {
        method: 'POST',
        body: JSON.stringify({ history_id: '77777777-7777-4777-8777-777777777777' }),
      },
    ), { params: Promise.resolve({ id: assignmentId }) })

    expect(response.status).toBe(404)
    expect(restoreContextualAssignmentDoc).not.toHaveBeenCalled()
  })

  it('rejects an unmatched teacher-valued restore before creating a service client', async () => {
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_DOC_HISTORY_ACCESS_PAIRS', '[]')
    const response = await restore(new NextRequest(
      `http://localhost/api/assignment-docs/${assignmentId}/restore`,
      { method: 'POST', body: JSON.stringify({ history_id: olderHistoryId }) },
    ), { params: Promise.resolve({ id: assignmentId }) })

    expect(response.status).toBe(403)
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })
})
