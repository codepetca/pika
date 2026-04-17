import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/course-blueprints/[id]/instantiate/route'

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({ id: 'teacher-1' })),
}))

vi.mock('@/lib/server/course-blueprints', () => ({
  createClassroomFromBlueprint: vi.fn(),
}))

describe('POST /api/teacher/course-blueprints/[id]/instantiate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a classroom from the route blueprint id', async () => {
    const { createClassroomFromBlueprint } = await import('@/lib/server/course-blueprints')
    ;(createClassroomFromBlueprint as any).mockResolvedValue({
      ok: true,
      classroom: { id: 'c-1', title: 'Semester Classroom' },
      lesson_mapping: { applied_lesson_templates: 2, overflow_lesson_templates: ['Overflow lesson'] },
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/course-blueprints/b-1/instantiate', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Semester Classroom',
        semester: 'semester1',
        year: 2026,
      }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'b-1' }) } as any)
    expect(response.status).toBe(201)
    expect(createClassroomFromBlueprint).toHaveBeenCalledWith(
      'teacher-1',
      expect.objectContaining({
        title: 'Semester Classroom',
        blueprintId: 'b-1',
      })
    )

    const data = await response.json()
    expect(data.lesson_mapping.applied_lesson_templates).toBe(2)
  })
})
