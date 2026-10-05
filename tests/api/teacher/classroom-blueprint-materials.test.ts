import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-handler'
import { GET } from '@/app/api/teacher/classrooms/[id]/blueprint-materials/route'

const mocks = vi.hoisted(() => ({ role: vi.fn(), read: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireRole: mocks.role }))
vi.mock('@/lib/server/classroom-blueprint-materials', () => ({ getClassroomBlueprintMaterials: mocks.read }))
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const request = new NextRequest(`http://localhost/api/teacher/classrooms/${id}/blueprint-materials`)
const context = { params: Promise.resolve({ id }) }

describe('teacher classroom Blueprint materials route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.role.mockResolvedValue({ id: 'teacher' })
    mocks.read.mockResolvedValue({ ok: true, materials: null })
  })

  it('rejects students before reading Blueprint data', async () => {
    mocks.role.mockRejectedValue(new ApiError(403, 'Forbidden'))
    expect((await GET(request, context)).status).toBe(403)
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('validates the classroom id before reading data', async () => {
    expect((await GET(request, { params: Promise.resolve({ id: 'invalid' }) })).status).toBe(400)
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('binds the lookup to the authenticated teacher and returns the material projection', async () => {
    const response = await GET(request, context)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ materials: null })
    expect(mocks.read).toHaveBeenCalledWith('teacher', id)
    expect(mocks.role).toHaveBeenCalledWith('teacher')
  })

  it('preserves ownership rejection from the server', async () => {
    mocks.read.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    const response = await GET(request, context)
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Forbidden' })
  })
})
