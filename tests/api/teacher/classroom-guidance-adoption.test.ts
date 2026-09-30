import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-handler'
import { GET, POST } from '@/app/api/teacher/classrooms/[id]/authoring-guidance/update/route'
const mocks = vi.hoisted(() => ({ role: vi.fn(), preview: vi.fn(), adopt: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireRole: mocks.role }))
vi.mock('@/lib/server/classroom-guidance-adoption', () => ({ previewClassroomGuidanceAdoption: mocks.preview, adoptClassroomGuidance: mocks.adopt }))
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const context = { params: Promise.resolve({ id }) }
const input = { blueprint_id: id, expected_content_version_id: id, expected_guidance_version_id: id, expected_draft_revision: 4 }
const request = (body: unknown) => new NextRequest(`http://localhost/api/teacher/classrooms/${id}/authoring-guidance/update`, { method: 'POST', body: JSON.stringify(body) })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.role.mockResolvedValue({ id: 'teacher' })
  mocks.preview.mockResolvedValue({ ok: true, preview: { guidance: 'Private rules' } })
  mocks.adopt.mockResolvedValue({ ok: true, version: 4 })
})
describe('teacher guidance adoption route', () => {
  it('rejects student reads and writes before private guidance is fetched', async () => {
    mocks.role.mockRejectedValue(new ApiError(403, 'Forbidden'))
    expect((await GET(request({}), context)).status).toBe(403)
    expect((await POST(request(input), context)).status).toBe(403)
    expect(mocks.preview).not.toHaveBeenCalled()
    expect(mocks.adopt).not.toHaveBeenCalled()
  })
  it('validates exact guards and disallows caller-supplied guidance', async () => {
    expect((await POST(request({ ...input, guidance: 'Injected' }), context)).status).toBe(400)
    expect(mocks.adopt).not.toHaveBeenCalled()
    expect((await POST(request(input), context)).status).toBe(200)
    expect(mocks.adopt).toHaveBeenCalledWith('teacher', id, input)
  })
})
