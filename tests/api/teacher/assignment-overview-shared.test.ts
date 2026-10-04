import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-error'
import { GET } from '@/app/api/teacher/assignments/[id]/route'

const actorId = '11111111-1111-4111-8111-111111111111'
const assignmentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn(), legacy: vi.fn(), read: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth, requireRole: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: mocks.client }))
vi.mock('@/lib/server/classroom-assignment-detail-access', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/server/classroom-assignment-detail-access')>(), authorizeClassroomAssignmentDetailRequest: mocks.legacy,
}))
vi.mock('@/lib/server/contextual-assignment-overview-read', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/server/contextual-assignment-overview-read')>(), readContextualAssignmentOverview: mocks.read,
}))

const request = () => new NextRequest(`http://localhost/api/teacher/assignments/${assignmentId}`)
const admission = (ids: string[] = [actorId]) => vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: ids }))
beforeEach(() => {
  vi.unstubAllEnvs(); vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ id: actorId, role: 'student' }); mocks.client.mockReturnValue({})
  mocks.read.mockResolvedValue({ assignment: { id: assignmentId }, classroom: {}, students: [], active_ai_grading_run: null })
  mocks.legacy.mockRejectedValue(new ApiError(404, 'Legacy sentinel'))
})

describe('shared overview GET admission and retained body', () => {
  it.each(['teacher', 'student'])('uses current-owner helper for admitted global role %s', async role => {
    admission(); mocks.auth.mockResolvedValue({ id: actorId, role })
    const response = await GET(request(), { params: Promise.resolve({ id: assignmentId.toUpperCase() }) })
    expect(response.status).toBe(200); expect(mocks.read).toHaveBeenCalledWith({ supabase: {}, actorId, assignmentId })
    expect(mocks.legacy).not.toHaveBeenCalled()
  })
  it('preserves absent admission without introducing another authentication call', async () => {
    const response = await GET(request(), { params: Promise.resolve({ id: 'old-literal-id' }) })
    expect(response.status).toBe(404); expect(await response.json()).toMatchObject({ error: 'Legacy sentinel' })
    expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.legacy).toHaveBeenCalledOnce(); expect(mocks.read).not.toHaveBeenCalled()
  })
  it('authenticates and strictly decodes present admission before params/discovery', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{bad')
    let accessed = false
    const context = { get params() { accessed = true; return Promise.resolve({ id: 'bad' }) } }
    const response = await GET(request(), context)
    expect(response.status).toBe(503); expect(mocks.auth).toHaveBeenCalledOnce(); expect(accessed).toBe(false)
    expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.legacy).not.toHaveBeenCalled()
  })
  it('retains pair/legacy fallback for authenticated but unadmitted actors', async () => {
    admission([]); const response = await GET(request(), { params: Promise.resolve({ id: 'old-literal-id' }) })
    expect(response.status).toBe(404); expect(mocks.legacy).toHaveBeenCalledOnce(); expect(mocks.read).not.toHaveBeenCalled()
  })
  it('rejects unauthorized authentication before malformed admission or params', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{bad'); mocks.auth.mockRejectedValue(new ApiError(401, 'Unauthorized'))
    const response = await GET(request(), { params: Promise.resolve({ id: 'bad' }) })
    expect(response.status).toBe(401); expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.legacy).not.toHaveBeenCalled()
  })
  it('validates admitted UUID parameters before service discovery', async () => {
    admission(); const response = await GET(request(), { params: Promise.resolve({ id: 'bad' }) })
    expect(response.status).toBe(400); expect(mocks.client).not.toHaveBeenCalled()
  })
  it('maps current owner denial and uncertain query evidence without fallback', async () => {
    admission()
    for (const status of [403, 503]) {
      mocks.read.mockRejectedValue(new ApiError(status, 'Unavailable'))
      const response = await GET(request(), { params: Promise.resolve({ id: assignmentId }) })
      expect(response.status).toBe(status); expect(mocks.legacy).not.toHaveBeenCalled()
    }
  })
})
