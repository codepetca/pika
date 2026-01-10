import { describe, it, expect, vi } from 'vitest'
import { POST } from '@/app/api/assignment-docs/[id]/restore/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'student-1', role: 'student' })) }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/server/classrooms', () => ({
  assertStudentCanAccessClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'class-1', archived_at: null },
  })),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('POST /api/assignment-docs/[id]/restore', () => {
  it('returns 400 when history_id is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/assignment-docs/assign-1/restore', {
      method: 'POST',
      body: JSON.stringify({})
    })

    const response = await POST(request, { params: { id: 'assign-1' } })
    expect(response.status).toBe(400)
  })

  it('records a restore snapshot after restoring', async () => {
    const restoredContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Restored' }] }],
    }

    const historyInsert = vi.fn().mockResolvedValue({ data: null, error: null })

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
              data: { id: 'doc-1', is_submitted: false },
              error: null,
            }),
          })),
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'doc-1', content: restoredContent },
                  error: null,
                }),
              })),
            })),
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
                    id: 'history-1',
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
          insert: historyInsert,
        }
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/assignment-docs/assign-1/restore', {
      method: 'POST',
      body: JSON.stringify({ history_id: 'history-1' })
    })

    const response = await POST(request, { params: { id: 'assign-1' } })
    expect(response.status).toBe(200)
    expect(historyInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        assignment_doc_id: 'doc-1',
        snapshot: restoredContent,
        trigger: 'restore',
      })
    )
  })
})
