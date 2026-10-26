import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), role: vi.fn(), page: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth, requireRole: mocks.role }))
vi.mock('@/lib/server/repolight-removed-student-cleanup', () => ({ readRepoLightRemovedTargetsPage: mocks.page }))
vi.mock('@/lib/server/live-student-cleanup', () => ({ isManualRepoLightCleanupEnabled: () => false }))
import { GET } from '@/app/api/teacher/classrooms/[id]/repolight-cleanup/route'
import { ApiError } from '@/lib/api-error'
const teacher = '10000000-0000-4000-8000-000000000001', classroom = '20000000-0000-4000-8000-000000000001'
const cursor = '30000000-0000-4000-8000-000000000001'
const params = { params: Promise.resolve({ id: classroom }) } as never
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', undefined)
  mocks.auth.mockResolvedValue({ id: teacher, role: 'teacher' })
  mocks.role.mockResolvedValue({ id: teacher })
  mocks.page.mockResolvedValue({ targets: [], next_student_id: null })
})
afterEach(() => vi.unstubAllEnvs())
describe('read-only repository report cleanup discovery', () => {
  it.each(['student', 'teacher'])('passes an admitted %s-labelled actor to exact owner discovery', async role => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [teacher] }))
    mocks.auth.mockResolvedValue({ id: teacher, role })
    expect((await GET(new NextRequest('http://localhost/repolight-cleanup'), params)).status).toBe(200)
    expect(mocks.page).toHaveBeenCalledExactlyOnceWith(teacher, classroom, null)
    expect(mocks.role).not.toHaveBeenCalled()
  })

  it('retains teacher fallback for an unmatched student despite dormant pair flags', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [] }))
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_OWNER_MUTATION_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_ASSIGNMENT_OWNER_MUTATION_ACCESS_PAIRS', JSON.stringify([{ userId: teacher, assignmentId: cursor }]))
    mocks.auth.mockResolvedValue({ id: teacher, role: 'student' }); mocks.role.mockRejectedValue(new ApiError(403, 'Forbidden'))
    expect((await GET(new NextRequest('http://localhost/repolight-cleanup'), params)).status).toBe(403)
    expect(mocks.role).toHaveBeenCalledExactlyOnceWith('teacher'); expect(mocks.page).not.toHaveBeenCalled()
  })

  it.each(['', 'broken', JSON.stringify({ version: 2, admittedUserIds: [teacher] })])('rejects malformed admission %j before discovery', async value => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', value)
    expect((await GET(new NextRequest('http://localhost/repolight-cleanup'), params)).status).toBe(503)
    expect(mocks.role).not.toHaveBeenCalled(); expect(mocks.page).not.toHaveBeenCalled()
  })

  it('authenticates before malformed configuration and preserves admitted nonowner denial', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', 'broken')
    mocks.auth.mockRejectedValueOnce(new ApiError(401, 'Unauthorized'))
    expect((await GET(new NextRequest('http://localhost/repolight-cleanup?broken=1'), params)).status).toBe(401)
    expect(mocks.page).not.toHaveBeenCalled()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [teacher] }))
    mocks.auth.mockResolvedValue({ id: teacher, role: 'student' }); mocks.page.mockRejectedValueOnce(new ApiError(403, 'Forbidden'))
    expect((await GET(new NextRequest('http://localhost/repolight-cleanup'), params)).status).toBe(403)
    expect(mocks.page).toHaveBeenCalledExactlyOnceWith(teacher, classroom, null)
  })

  it('authorizes owner-scoped empty pages and remains readable while Analyze/cleanup is paused', async () => {
    const response = await GET(new NextRequest('http://localhost/repolight-cleanup'), params)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ targets: [], enabled: false, nextStudentId: null })
    expect(mocks.page).toHaveBeenCalledWith(teacher, classroom, null)
  })
  it('preserves continuation even when completed history filters a whole page out', async () => {
    mocks.page.mockResolvedValue({ targets: [{ pending_subject_count: 0, status: 'completed' }], next_student_id: cursor })
    const response = await GET(new NextRequest('http://localhost/repolight-cleanup'), params)
    expect(await response.json()).toEqual({ targets: [], enabled: false, nextStudentId: cursor })
  })
  it('forwards the exact requested cursor and never invents a broader target', async () => {
    await GET(new NextRequest(`http://localhost/repolight-cleanup?afterStudentId=${cursor}`), params)
    expect(mocks.page).toHaveBeenCalledWith(teacher, classroom, cursor)
    expect((await GET(new NextRequest('http://localhost/repolight-cleanup?teacherId=forged'), params)).status).toBe(400)
  })
  it('authenticates before parsing targets and preserves database ownership denial', async () => {
    mocks.role.mockRejectedValueOnce(new ApiError(401, 'Unauthorized'))
    expect((await GET(new NextRequest('http://localhost/repolight-cleanup?broken=1'), params)).status).toBe(401)
    expect(mocks.page).not.toHaveBeenCalled()
    mocks.page.mockRejectedValueOnce(new ApiError(403, 'Forbidden'))
    expect((await GET(new NextRequest('http://localhost/repolight-cleanup'), params)).status).toBe(403)
  })
})
