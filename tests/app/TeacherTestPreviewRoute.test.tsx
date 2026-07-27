import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TestPreviewPage from '@/app/classrooms/[classroomId]/tests/[testId]/preview/page'
import { getCurrentUser } from '@/lib/auth'
import { assertTeacherOwnsTest } from '@/lib/server/tests'

const { mockNotFound, mockRedirect } = vi.hoisted(() => ({
  mockNotFound: vi.fn(),
  mockRedirect: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  notFound: mockNotFound,
  redirect: mockRedirect,
}))

vi.mock('@/lib/auth', () => ({
  getCurrentUser: vi.fn(),
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
  beforeEach(() => {
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

  it('redirects unauthenticated visitors before looking up the test', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)

    await expect(TestPreviewPage({ params })).rejects.toThrow('NEXT_REDIRECT')

    expect(mockRedirect).toHaveBeenCalledWith('/login')
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
