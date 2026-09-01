import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ClassroomPage from '@/app/classrooms/[classroomId]/page'
import { DEFAULT_CLASSROOM_FEATURE_VISIBILITY } from '@/lib/classroom-feature-visibility'

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getPalApiUrl: vi.fn(),
  getUserDisplayInfo: vi.fn(),
  listActiveTeacherClassrooms: vi.fn(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  singleResults: [] as Array<{ data: unknown; error: unknown }>,
}))

vi.mock('next/navigation', () => ({
  redirect: (url: string) => mocks.redirect(url),
  notFound: () => mocks.notFound(),
}))

vi.mock('@/lib/auth', () => ({
  getCurrentUser: () => mocks.getCurrentUser(),
}))

vi.mock('@/lib/server/pal-config', () => ({
  getPalApiUrl: () => mocks.getPalApiUrl(),
}))

vi.mock('@/lib/user-profile', () => ({
  getUserDisplayInfo: (...args: unknown[]) => mocks.getUserDisplayInfo(...args),
}))

vi.mock('@/lib/server/classroom-order', () => ({
  listActiveTeacherClassrooms: (...args: unknown[]) => mocks.listActiveTeacherClassrooms(...args),
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: () => ({
    from: () => {
      const query: Record<string, any> = {}
      for (const method of ['select', 'eq', 'is']) {
        query[method] = vi.fn(() => query)
      }
      query.single = vi.fn(async () => mocks.singleResults.shift())
      return query
    },
  }),
}))

vi.mock('@/app/classrooms/[classroomId]/ClassroomPageClient', () => ({
  ClassroomPageClient: ({ user, initialTab }: { user: { role: string }; initialTab?: string }) => (
    <div data-testid="classroom-page" data-role={user.role} data-tab={initialTab || ''} />
  ),
}))

const classroom = (featureVisibility = DEFAULT_CLASSROOM_FEATURE_VISIBILITY) => ({
  id: 'classroom-1',
  teacher_id: 'teacher-1',
  title: 'Course',
  archived_at: null,
  feature_visibility: featureVisibility,
})

async function renderPage(tab: string) {
  const page = await ClassroomPage({
    params: Promise.resolve({ classroomId: 'classroom-1' }),
    searchParams: Promise.resolve({ tab }),
  })
  render(page)
}

describe('ClassroomPage feature visibility redirects', () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockReset()
    mocks.getPalApiUrl.mockReset()
    mocks.getUserDisplayInfo.mockReset()
    mocks.listActiveTeacherClassrooms.mockReset()
    mocks.redirect.mockReset()
    mocks.notFound.mockReset()
    mocks.singleResults = []

    mocks.getPalApiUrl.mockReturnValue('https://pal.example.test')
    mocks.getUserDisplayInfo.mockResolvedValue({ displayName: 'Test User' })
    mocks.listActiveTeacherClassrooms.mockResolvedValue({ data: [], error: null })
    mocks.redirect.mockImplementation((url: string) => {
      throw new Error(`redirect:${url}`)
    })
    mocks.notFound.mockImplementation(() => {
      throw new Error('not-found')
    })
  })

  it.each([
    {
      tab: 'attendance',
      visibility: DEFAULT_CLASSROOM_FEATURE_VISIBILITY,
    },
    {
      tab: 'tests',
      visibility: { ...DEFAULT_CLASSROOM_FEATURE_VISIBILITY, tests: false },
    },
    {
      tab: 'gradebook',
      visibility: {
        ...DEFAULT_CLASSROOM_FEATURE_VISIBILITY,
        classwork: false,
        tests: false,
        gradebook: true,
      },
    },
  ])('redirects a teacher hidden $tab direct link to Daily', async ({ tab, visibility }) => {
    mocks.getCurrentUser.mockResolvedValue({
      id: 'teacher-1',
      email: 'teacher@example.test',
      role: 'teacher',
    })
    mocks.singleResults.push({ data: classroom(visibility), error: null })

    await expect(renderPage(tab)).rejects.toThrow('redirect:/classrooms/classroom-1?tab=daily')
    expect(mocks.redirect).toHaveBeenCalledWith('/classrooms/classroom-1?tab=daily')
  })

  it('keeps the teacher Daily core tab available', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: 'teacher-1',
      email: 'teacher@example.test',
      role: 'teacher',
    })
    mocks.singleResults.push({
      data: classroom({
        ...DEFAULT_CLASSROOM_FEATURE_VISIBILITY,
        attendance: false,
        classwork: false,
        tests: false,
        gradebook: false,
        calendar: false,
        syllabus: false,
        announcements: false,
        achievements: false,
      }),
      error: null,
    })

    await renderPage('daily')

    expect(mocks.redirect).not.toHaveBeenCalled()
    expect(screen.getByTestId('classroom-page')).toHaveAttribute('data-role', 'teacher')
  })

  it.each([
    {
      tab: 'tests',
      palUrl: 'https://pal.example.test',
      visibility: { ...DEFAULT_CLASSROOM_FEATURE_VISIBILITY, tests: false },
    },
    {
      tab: 'achievements',
      palUrl: null,
      visibility: DEFAULT_CLASSROOM_FEATURE_VISIBILITY,
    },
  ])('redirects a student unavailable $tab direct link to Daily', async ({ tab, palUrl, visibility }) => {
    mocks.getCurrentUser.mockResolvedValue({
      id: 'student-1',
      email: 'student@example.test',
      role: 'student',
    })
    mocks.getPalApiUrl.mockReturnValue(palUrl)
    mocks.singleResults.push(
      { data: { classroom_id: 'classroom-1' }, error: null },
      { data: classroom(visibility), error: null },
    )

    await expect(renderPage(tab)).rejects.toThrow('redirect:/classrooms/classroom-1?tab=today')
    expect(mocks.redirect).toHaveBeenCalledWith('/classrooms/classroom-1?tab=today')
  })

  it('keeps the student Daily core tab available', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: 'student-1',
      email: 'student@example.test',
      role: 'student',
    })
    mocks.singleResults.push(
      { data: { classroom_id: 'classroom-1' }, error: null },
      {
        data: classroom({
          ...DEFAULT_CLASSROOM_FEATURE_VISIBILITY,
          classwork: false,
          tests: false,
          calendar: false,
          syllabus: false,
          announcements: false,
          achievements: false,
        }),
        error: null,
      },
    )

    await renderPage('today')

    expect(mocks.redirect).not.toHaveBeenCalled()
    expect(screen.getByTestId('classroom-page')).toHaveAttribute('data-role', 'student')
  })
})
