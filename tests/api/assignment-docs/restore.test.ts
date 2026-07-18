import { describe, it, expect, vi } from 'vitest'
import { POST } from '@/app/api/assignment-docs/[id]/restore/route'
import { NextRequest } from 'next/server'
import { saveAssignmentDocAtomic } from '@/lib/server/assignment-doc-submissions'

vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'student-1', role: 'student' })) }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/server/classrooms', () => ({
  assertStudentCanAccessClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'class-1', archived_at: null },
  })),
}))
vi.mock('@/lib/server/assignment-doc-submissions', () => ({
  saveAssignmentDocAtomic: vi.fn(),
}))

const mockSupabaseClient = { from: vi.fn() }
const HISTORY_ID = '10000000-0000-4000-8000-000000000001'

describe('POST /api/assignment-docs/[id]/restore', () => {
  it('returns 400 when history_id is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/assignment-docs/assign-1/restore', {
      method: 'POST',
      body: JSON.stringify({})
    })

    const response = await POST(request, { params: { id: 'assign-1' } })
    expect(response.status).toBe(400)
  })

  it('returns 400 when history_id is not a UUID', async () => {
    const request = new NextRequest('http://localhost:3000/api/assignment-docs/assign-1/restore', {
      method: 'POST',
      body: JSON.stringify({ history_id: 'history-1' })
    })

    const response = await POST(request, { params: { id: 'assign-1' } })
    expect(response.status).toBe(400)
  })

  it('records a restore snapshot after restoring', async () => {
    const restoredContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Restored' }] }],
    }

    vi.mocked(saveAssignmentDocAtomic).mockResolvedValueOnce({
      ok: true,
      doc: { id: 'doc-1', content: restoredContent } as any,
      historyEntry: null,
    })

    const mockFrom = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'assign-1', classroom_id: 'class-1' },
                error: null,
              }),
            })),
          })),
        }
      }
      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { id: 'enroll-1' }, error: null }),
          })),
        }
      }
      if (table === 'assignment_docs') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'doc-1',
                is_submitted: false,
                content: { type: 'doc', content: [] },
                updated_at: '2025-01-01T00:00:00.000Z',
              },
              error: null,
            }),
          })),
        }
      }
      if (table === 'assignment_doc_history') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: HISTORY_ID,
                    assignment_doc_id: 'doc-1',
                    patch: null,
                    snapshot: restoredContent,
                    word_count: 1,
                    char_count: 8,
                    trigger: 'autosave',
                    created_at: '2025-01-01T00:00:00Z',
                  },
                ],
                error: null,
              }),
            })),
          })),
        }
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/assignment-docs/assign-1/restore', {
      method: 'POST',
      body: JSON.stringify({ history_id: HISTORY_ID })
    })

    const response = await POST(request, { params: { id: 'assign-1' } })
    expect(response.status).toBe(200)
    expect(saveAssignmentDocAtomic).toHaveBeenCalledWith(expect.objectContaining({
      assignmentId: 'assign-1',
      previousContent: { type: 'doc', content: [] },
      content: restoredContent,
      expectedUpdatedAt: '2025-01-01T00:00:00.000Z',
      trigger: 'restore',
    }))
  })
})
