import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/classrooms/[id]/use-again/route'

const mockRequireRole = vi.fn()
const mockPrepareArchivedClassroomReuse = vi.fn()

vi.mock('@/lib/auth', () => ({
  requireRole: (...args: any[]) => mockRequireRole(...args),
}))

vi.mock('@/lib/server/archived-classroom-reuse', () => ({
  prepareArchivedClassroomReuse: (...args: any[]) =>
    mockPrepareArchivedClassroomReuse(...args),
}))

describe('archived classroom use-again route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireRole.mockResolvedValue({
      id: '10000000-0000-4000-8000-000000000001',
    })
  })

  it('prepares reuse with the caller idempotency key', async () => {
    mockPrepareArchivedClassroomReuse.mockResolvedValue({
      ok: true,
      status: 'ready',
      blueprint_id: '20000000-0000-4000-8000-000000000001',
      blueprint_title: 'Course',
    })

    const response = await POST(
      new NextRequest(
        'http://localhost:3000/api/teacher/classrooms/30000000-0000-4000-8000-000000000001/use-again',
        {
          method: 'POST',
          headers: {
            'Idempotency-Key': '40000000-0000-4000-8000-000000000001',
          },
        },
      ),
      {
        params: Promise.resolve({
          id: '30000000-0000-4000-8000-000000000001',
        }),
      } as any,
    )

    expect(mockPrepareArchivedClassroomReuse).toHaveBeenCalledWith({
      teacherId: '10000000-0000-4000-8000-000000000001',
      classroomId: '30000000-0000-4000-8000-000000000001',
      operationId: '40000000-0000-4000-8000-000000000001',
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({
      status: 'ready',
      blueprint_id: '20000000-0000-4000-8000-000000000001',
    }))
  })
})
