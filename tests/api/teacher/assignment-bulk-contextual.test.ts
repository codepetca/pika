import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

import { POST } from '@/app/api/teacher/assignments/bulk/route'
import { authorizeContextualAssignmentBulkRequest } from '@/lib/server/contextual-assignment-bulk-access'
import { saveAssignmentsBulkForOwner } from '@/lib/server/contextual-assignment-bulk'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const assignmentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const user = { id: actorId, role: 'student', email: 'owner@example.com' }
const mockSupabase = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabase) }))
vi.mock('@/lib/server/contextual-assignment-bulk-access', () => ({
  authorizeContextualAssignmentBulkRequest: vi.fn(),
}))
vi.mock('@/lib/server/contextual-assignment-bulk', () => ({
  saveAssignmentsBulkForOwner: vi.fn(),
}))

describe('contextual Assignment bulk route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authorizeContextualAssignmentBulkRequest).mockResolvedValue({
      mode: 'contextual', user: user as any, classroomId,
    })
  })

  it('routes a student-valued owner batch through the fenced RPC', async () => {
    vi.mocked(saveAssignmentsBulkForOwner).mockResolvedValue({
      ok: true,
      created: 0,
      updated: 1,
      assignments: [{ id: assignmentId }] as any,
    })
    const response = await POST(new NextRequest(
      'http://localhost/api/teacher/assignments/bulk',
      {
        method: 'POST',
        body: JSON.stringify({
          classroom_id: classroomId,
          assignments: [{
            id: assignmentId,
            title: 'Updated',
            due_at: '2026-09-30T20:00:00.000Z',
            instructions: '# Directions',
            is_draft: true,
            position: 0,
          }],
        }),
      },
    ))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ created: 0, updated: 1 })
    expect(saveAssignmentsBulkForOwner).toHaveBeenCalledWith(expect.objectContaining({
      supabase: mockSupabase,
      actorId,
      classroomId,
      assignments: [expect.objectContaining({
        id: assignmentId,
        title: 'Updated',
        instructionsMarkdown: '# Directions',
      })],
    }))
    expect(mockSupabase.from).not.toHaveBeenCalled()
  })

  it('returns the established errors array for contextual validation failures', async () => {
    vi.mocked(saveAssignmentsBulkForOwner).mockResolvedValue({
      ok: false,
      errors: [`Assignment ID not found: ${assignmentId}`],
    })
    const response = await POST(new NextRequest(
      'http://localhost/api/teacher/assignments/bulk',
      {
        method: 'POST',
        body: JSON.stringify({
          classroom_id: classroomId,
          assignments: [{
            id: assignmentId,
            title: 'Missing',
            due_at: '2026-09-30T20:00:00.000Z',
            instructions: '',
            is_draft: true,
            position: 0,
          }],
        }),
      },
    ))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ errors: [`Assignment ID not found: ${assignmentId}`] })
  })
})
