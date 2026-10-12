import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api-error'
import TestPreviewPage from '@/app/classrooms/[classroomId]/tests/[testId]/preview/page'
import { getCurrentUser } from '@/lib/auth'
import { assertTeacherOwnsTest } from '@/lib/server/tests'

const { mockGetServerLoginRedirectPath, mockNotFound, mockRedirect, mockRead, mockService } = vi.hoisted(() => ({
  mockRead: vi.fn(),
  mockService: vi.fn(() => ({})),
  mockGetServerLoginRedirectPath: vi.fn(() => '/login?next=%2Fteacher%2Fpreview'),
  mockNotFound: vi.fn(),
  mockRedirect: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: mockService }))
vi.mock('@/lib/server/contextual-test-detail-read', () => ({ readContextualTestDetail: mockRead }))

vi.mock('next/navigation', () => ({
  notFound: mockNotFound,
  redirect: mockRedirect,
}))

vi.mock('@/lib/auth', () => ({
  getCurrentUser: vi.fn(),
}))

vi.mock('@/lib/server/auth-redirect', () => ({
  getServerLoginRedirectPath: mockGetServerLoginRedirectPath,
}))

vi.mock('@/lib/server/tests', () => ({
  assertTeacherOwnsTest: vi.fn(),
}))

vi.mock('@/components/TeacherTestPreviewPage', () => ({
  TeacherTestPreviewPage: ({
    classroomId,
    testId,
  }: {
    classroomId: string
    testId: string
  }) => (
    <div data-testid="teacher-test-preview">
      {classroomId}:{testId}
    </div>
  ),
}))

const params = Promise.resolve({
  classroomId: 'classroom-1',
  testId: 'test-1',
})

describe('standalone teacher test preview route', () => {
  afterEach(() => vi.unstubAllEnvs())
  beforeEach(() => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', undefined)
    vi.clearAllMocks()
    mockRedirect.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT')
    })
    mockNotFound.mockImplementation(() => {
      throw new Error('NEXT_NOT_FOUND')
    })
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: 'teacher-1',
      role: 'teacher',
    } as Awaited<ReturnType<typeof getCurrentUser>>)
    vi.mocked(assertTeacherOwnsTest).mockResolvedValue({
      ok: true,
      test: {
        id: 'test-1',
        classroom_id: 'classroom-1',
      },
    } as Awaited<ReturnType<typeof assertTeacherOwnsTest>>)
  })

  it.each(['teacher', 'student'])('allows a shared current owner with account role %s', async (role) => {
    const id = '11111111-1111-4111-8111-111111111111'
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [id] }))
    vi.mocked(getCurrentUser).mockResolvedValue({ id, role } as Awaited<ReturnType<typeof getCurrentUser>>)
    mockRead.mockResolvedValue({ test: { id: 'test-1', classroom_id: 'classroom-1' } })
    render(await TestPreviewPage({ params }))
    expect(screen.getByTestId('teacher-test-preview')).toHaveTextContent('classroom-1:test-1')
    expect(mockRead).toHaveBeenCalledWith({ supabase: {}, actorId: id, testId: 'test-1' })
    expect(assertTeacherOwnsTest).not.toHaveBeenCalled()
  })

  it.each([400, 403, 404, 503])('contains shared denial %s without legacy fallback', async (status) => {
    const id = '11111111-1111-4111-8111-111111111111'
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [id] }))
    vi.mocked(getCurrentUser).mockResolvedValue({ id, role: 'student' } as Awaited<ReturnType<typeof getCurrentUser>>)
    mockRead.mockRejectedValue(new ApiError(status, 'Unavailable'))
    await expect(TestPreviewPage({ params })).rejects.toThrow(status === 503 ? 'Unavailable' : 'NEXT_NOT_FOUND')
    expect(assertTeacherOwnsTest).not.toHaveBeenCalled()
  })

  it('denies a shared foreign parent and malformed admission before constructing a service client', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    vi.mocked(getCurrentUser).mockResolvedValue({ id, role: 'teacher' } as Awaited<ReturnType<typeof getCurrentUser>>)
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [id] }))
    mockRead.mockResolvedValue({ test: { id: 'test-1', classroom_id: 'foreign' } })
    await expect(TestPreviewPage({ params })).rejects.toThrow('NEXT_NOT_FOUND')
    mockService.mockClear()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '')
    await expect(TestPreviewPage({ params })).rejects.toThrow('admission configuration')
    expect(mockService).not.toHaveBeenCalled()
    expect(assertTeacherOwnsTest).not.toHaveBeenCalled()
  })

  it('keeps unmatched admission on the original teacher preview contract', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [] }))
    vi.mocked(getCurrentUser).mockResolvedValue({ id, role: 'teacher' } as Awaited<ReturnType<typeof getCurrentUser>>)
    render(await TestPreviewPage({ params }))
    expect(assertTeacherOwnsTest).toHaveBeenCalledWith(id, 'test-1')
    expect(mockRead).not.toHaveBeenCalled()
    expect(mockService).not.toHaveBeenCalled()
  })

  it('redirects unauthenticated visitors before looking up the test', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)

    await expect(TestPreviewPage({ params })).rejects.toThrow('NEXT_REDIRECT')

    expect(mockRedirect).toHaveBeenCalledWith('/login?next=%2Fteacher%2Fpreview')
    expect(assertTeacherOwnsTest).not.toHaveBeenCalled()
  })

  it('returns not found for authenticated non-teachers', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: 'student-1',
      role: 'student',
    } as Awaited<ReturnType<typeof getCurrentUser>>)

    await expect(TestPreviewPage({ params })).rejects.toThrow('NEXT_NOT_FOUND')

    expect(mockNotFound).toHaveBeenCalledOnce()
    expect(assertTeacherOwnsTest).not.toHaveBeenCalled()
  })

  it('returns not found when the teacher does not own the test', async () => {
    vi.mocked(assertTeacherOwnsTest).mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Forbidden',
    })

    await expect(TestPreviewPage({ params })).rejects.toThrow('NEXT_NOT_FOUND')

    expect(assertTeacherOwnsTest).toHaveBeenCalledWith('teacher-1', 'test-1')
    expect(mockNotFound).toHaveBeenCalledOnce()
  })

  it('returns not found when the URL classroom does not own the authorized test', async () => {
    vi.mocked(assertTeacherOwnsTest).mockResolvedValue({
      ok: true,
      test: {
        id: 'test-1',
        classroom_id: 'classroom-2',
      },
    } as Awaited<ReturnType<typeof assertTeacherOwnsTest>>)

    await expect(TestPreviewPage({ params })).rejects.toThrow('NEXT_NOT_FOUND')

    expect(mockNotFound).toHaveBeenCalledOnce()
  })

  it('renders the preview only after teacher, ownership, and classroom checks pass', async () => {
    const page = await TestPreviewPage({ params })
    render(page)

    expect(screen.getByTestId('teacher-test-preview')).toHaveTextContent(
      'classroom-1:test-1',
    )
    expect(assertTeacherOwnsTest).toHaveBeenCalledWith('teacher-1', 'test-1')
    expect(mockRedirect).not.toHaveBeenCalled()
    expect(mockNotFound).not.toHaveBeenCalled()
  })
})
