import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

import { POST } from '@/app/api/teacher/assignments/route'
import { authorizeContextualClassworkCreationRequest } from '@/lib/server/contextual-classwork-creation-access'
import { createAssignmentForOwner } from '@/lib/server/contextual-assignment-creation'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const assignmentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const user = { id: actorId, role: 'student', email: 'owner@example.com' }
const mockSupabase = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabase) }))
vi.mock('@/lib/server/contextual-classwork-creation-access', () => ({
  authorizeContextualClassworkCreationRequest: vi.fn(),
}))
vi.mock('@/lib/server/contextual-assignment-creation', () => ({
  createAssignmentForOwner: vi.fn(),
}))

describe('contextual Assignment creation route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authorizeContextualClassworkCreationRequest).mockResolvedValue({
      mode: 'contextual', user: user as any, classroomId,
    })
    vi.mocked(createAssignmentForOwner).mockResolvedValue({
      assignment: {
        id: assignmentId,
        classroom_id: classroomId,
        created_by: actorId,
        title: 'Essay',
      } as never,
      submissionRequirements: [],
    })
  })

  it('routes a student-valued exact-pair owner through the actor-bound creation RPC', async () => {
    const response = await POST(new NextRequest(
      'http://localhost/api/teacher/assignments',
      {
        method: 'POST',
        body: JSON.stringify({
          classroom_id: classroomId,
          title: ' Essay ',
          instructions_markdown: 'Write an essay.',
          due_at: '2099-01-01T23:59:59.000Z',
          submission_requirements: [],
        }),
      },
    ))

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      assignment: { id: assignmentId, submission_requirements: [] },
    })
    expect(createAssignmentForOwner).toHaveBeenCalledWith(expect.objectContaining({
      actorId,
      classroomId,
      title: 'Essay',
      requirements: [],
    }))
    expect(mockSupabase.from).not.toHaveBeenCalled()
  })

  it('rejects unknown request keys at the route boundary', async () => {
    const response = await POST(new NextRequest(
      'http://localhost/api/teacher/assignments',
      {
        method: 'POST',
        body: JSON.stringify({
          classroom_id: classroomId,
          title: 'Essay',
          due_at: '2099-01-01T23:59:59.000Z',
          created_by: actorId,
        }),
      },
    ))

    expect(response.status).toBe(400)
    expect(createAssignmentForOwner).not.toHaveBeenCalled()
  })
})
