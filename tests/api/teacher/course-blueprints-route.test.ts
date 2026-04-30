import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/teacher/course-blueprints/route'
import { GET as GET_BY_ID, PATCH, DELETE } from '@/app/api/teacher/course-blueprints/[id]/route'

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({ id: 'teacher-1' })),
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabase),
}))

vi.mock('@/lib/server/course-blueprints', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/course-blueprints')>('@/lib/server/course-blueprints')
  return {
    ...actual,
    createCourseBlueprint: vi.fn(),
    listTeacherCourseBlueprints: vi.fn(),
    getCourseBlueprintDetail: vi.fn(),
    updateCourseBlueprint: vi.fn(),
    deleteCourseBlueprint: vi.fn(),
  }
})

const mockSupabase = { from: vi.fn() }

describe('teacher course blueprints routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists blueprints', async () => {
    const { listTeacherCourseBlueprints } = await import('@/lib/server/course-blueprints')
    ;(listTeacherCourseBlueprints as any).mockResolvedValue({
      data: [{ id: 'b-1', title: 'Blueprint 1' }],
      error: null,
    })

    const response = await GET(new NextRequest('http://localhost:3000/api/teacher/course-blueprints'))
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.blueprints).toHaveLength(1)
  })

  it('creates a blueprint', async () => {
    const { createCourseBlueprint } = await import('@/lib/server/course-blueprints')
    ;(createCourseBlueprint as any).mockResolvedValue({
      id: 'b-1',
      title: 'Blueprint 1',
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/course-blueprints', {
      method: 'POST',
      body: JSON.stringify({ title: 'Blueprint 1' }),
    })
    const response = await POST(request)
    expect(response.status).toBe(201)
    const data = await response.json()
    expect(data.blueprint.id).toBe('b-1')
  })

  it('returns blueprint detail', async () => {
    const { getCourseBlueprintDetail } = await import('@/lib/server/course-blueprints')
    ;(getCourseBlueprintDetail as any).mockResolvedValue({
      detail: { id: 'b-1', title: 'Blueprint 1' },
    })

    const response = await GET_BY_ID(new NextRequest('http://localhost:3000/api/teacher/course-blueprints/b-1'), {
      params: Promise.resolve({ id: 'b-1' }),
    } as any)

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.blueprint.id).toBe('b-1')
  })

  it('updates a blueprint', async () => {
    const { updateCourseBlueprint } = await import('@/lib/server/course-blueprints')
    ;(updateCourseBlueprint as any).mockResolvedValue({
      ok: true,
      blueprint: { id: 'b-1', title: 'Updated Blueprint' },
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/course-blueprints/b-1', {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Updated Blueprint' }),
    })
    const response = await PATCH(request, { params: Promise.resolve({ id: 'b-1' }) } as any)
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.blueprint.title).toBe('Updated Blueprint')
  })

  it('deletes a blueprint', async () => {
    const { deleteCourseBlueprint } = await import('@/lib/server/course-blueprints')
    ;(deleteCourseBlueprint as any).mockResolvedValue({ ok: true })

    const response = await DELETE(new NextRequest('http://localhost:3000/api/teacher/course-blueprints/b-1', {
      method: 'DELETE',
    }), {
      params: Promise.resolve({ id: 'b-1' }),
    } as any)

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.success).toBe(true)
  })
})
