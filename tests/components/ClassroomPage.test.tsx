import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClassroomPage from '@/app/classrooms/[classroomId]/page'
import { DEFAULT_CLASSROOM_FEATURE_VISIBILITY } from '@/lib/classroom-feature-visibility'

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  clientProps: vi.fn(),
  getAttendanceAccess: vi.fn(),
  getPalApiUrl: vi.fn(),
  classroomPalRequested: vi.fn(),
  contextualPal: vi.fn(),
  legacyPal: vi.fn(),
  getUserDisplayInfo: vi.fn(),
  listActiveTeacherClassrooms: vi.fn(),
  resolvePageAccess: vi.fn(),
  serviceConstructed: vi.fn(),
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
  isClassroomPalRequested: () => mocks.classroomPalRequested(),
  getPalApiUrl: () => mocks.getPalApiUrl(),
}))

vi.mock('@/lib/server/contextual-pal-classroom', () => ({
  resolveContextualPalClassroomContext: (...args: unknown[]) => mocks.contextualPal(...args),
}))
vi.mock('@/lib/server/pal-classroom', () => ({
  resolvePalClassroomContext: (...args: unknown[]) => mocks.legacyPal(...args),
}))
vi.mock('@/integrations/pal', () => ({
  StudentPalExperience: ({ children, scopeKey }: { children: React.ReactNode; scopeKey: string }) => (
    <div data-testid="membership-provider" data-scope={scopeKey}>{children}</div>
  ),
}))

vi.mock('@/lib/server/bara-attendance-scope', () => ({
  getBaraAttendanceClassroomAccess: (...args: unknown[]) => mocks.getAttendanceAccess(...args),
}))

vi.mock('@/lib/user-profile', () => ({
  getUserDisplayInfo: (...args: unknown[]) => mocks.getUserDisplayInfo(...args),
}))

vi.mock('@/lib/server/classroom-order', () => ({
  listActiveTeacherClassrooms: (...args: unknown[]) => mocks.listActiveTeacherClassrooms(...args),
}))

vi.mock('@/lib/server/classroom-page-access', () => ({
  resolveClassroomPagePilotAccess: (...args: unknown[]) => mocks.resolvePageAccess(...args),
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: () => { mocks.serviceConstructed(); return ({
    from: () => {
      const query: Record<string, any> = {}
      for (const method of ['select', 'eq', 'is']) {
        query[method] = vi.fn(() => query)
      }
      query.single = vi.fn(async () => mocks.singleResults.shift())
      return query
    },
  }) },
}))

vi.mock('@/app/classrooms/[classroomId]/ClassroomPageClient', () => ({
  ClassroomPageClient: ({ initialNow, classroom: classroomRecord, user, classroomRole, initialTab, classroomQrAvailable, testExperienceMode, palEnabled }: { initialNow: number; classroom: unknown; user: { role: string }; classroomRole?: string; initialTab?: string; classroomQrAvailable?: boolean; testExperienceMode?: string; palEnabled?: boolean }) => {
    mocks.clientProps(classroomRecord)
    return <div data-test-experience={testExperienceMode} data-initial-now={initialNow} data-testid="classroom-page" data-role={user.role} data-classroom-role={classroomRole || user.role} data-tab={initialTab || ''} data-classroom-qr={String(classroomQrAvailable === true)} data-pal={String(palEnabled === true)} />
  },
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
  afterEach(() => vi.unstubAllEnvs())
  beforeEach(() => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', undefined)
    mocks.serviceConstructed.mockClear()
    mocks.getCurrentUser.mockReset()
    mocks.getAttendanceAccess.mockResolvedValue({ state: 'disabled', scheduleThrough: null })
    mocks.getPalApiUrl.mockReset()
    mocks.classroomPalRequested.mockReturnValue(false)
    mocks.contextualPal.mockReset()
    mocks.legacyPal.mockReset()
    mocks.getUserDisplayInfo.mockReset()
    mocks.listActiveTeacherClassrooms.mockReset()
    mocks.resolvePageAccess.mockReset()
    mocks.redirect.mockReset()
    mocks.notFound.mockReset()
    mocks.singleResults = []

    mocks.getPalApiUrl.mockReturnValue('https://pal.example.test')
    mocks.getUserDisplayInfo.mockResolvedValue({ displayName: 'Test User' })
    mocks.listActiveTeacherClassrooms.mockResolvedValue({ data: [], error: null })
    mocks.resolvePageAccess.mockResolvedValue({ mode: 'legacy' })
    mocks.redirect.mockImplementation((url: string) => {
      throw new Error(`redirect:${url}`)
    })
    mocks.notFound.mockImplementation(() => {
      throw new Error('not-found')
    })
  })

  it.each(['teacher', 'student'] as const)('serializes shared Test mode independently of the %s page relationship', async (role) => {
    const id = '11111111-1111-4111-8111-111111111111'
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [id] }))
    mocks.getCurrentUser.mockResolvedValue({ id, role })
    mocks.singleResults.push({ data: classroom(), error: null })
    if (role === 'student') mocks.singleResults.push({ data: classroom(), error: null })
    await renderPage(role === 'teacher' ? 'daily' : 'today')
    expect(screen.getByTestId('classroom-page')).toHaveAttribute('data-test-experience', 'shared')
    expect(screen.getByTestId('classroom-page')).toHaveAttribute('data-role', role)
    expect(screen.getByTestId('classroom-page')).toHaveAttribute('data-classroom-role', role)
  })

  const memberId = '22222222-2222-4222-8222-222222222222'
  const scopedContext = { status: 'active', generation_id: '44444444-4444-4444-8444-444444444444',
    learner_id: `pika-membership-v1-${'a'.repeat(32)}`, scope_key: `pika-classroom-v1-${'b'.repeat(64)}` }
  function prepareMember(role: 'teacher' | 'student') {
    mocks.getCurrentUser.mockResolvedValue({ id: memberId, email: 'member@example.test', role })
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [memberId] }))
    mocks.resolvePageAccess.mockResolvedValue({ mode: 'contextual', context: { relationship: 'member' } })
    mocks.singleResults.push({ data: { classroom_id: 'classroom-1' }, error: null }, { data: classroom(), error: null })
  }

  it.each(['teacher', 'student'] as const)('uses the contextual scoped Pal reader for an admitted %s member', async role => {
    prepareMember(role)
    mocks.classroomPalRequested.mockReturnValue(true)
    mocks.contextualPal.mockResolvedValue(scopedContext)
    mocks.legacyPal.mockResolvedValue({ ...scopedContext, scope_key: 'wrong-legacy-scope' })
    await renderPage('today')
    expect(mocks.contextualPal).toHaveBeenCalledExactlyOnceWith({ studentId: memberId, classroomId: 'classroom-1' })
    expect(mocks.legacyPal).not.toHaveBeenCalled()
    expect(screen.getByTestId('membership-provider')).toHaveAttribute('data-scope', scopedContext.scope_key)
    expect(screen.getByTestId('classroom-page')).toHaveAttribute('data-role', role)
    expect(screen.getByTestId('classroom-page')).toHaveAttribute('data-classroom-role', 'student')
  })

  it.each(['teacher', 'student'] as const)('does not resolve learner Pal context for an admitted %s owner', async role => {
    mocks.getCurrentUser.mockResolvedValue({ id: memberId, role })
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [memberId] }))
    mocks.resolvePageAccess.mockResolvedValue({ mode: 'contextual', context: { relationship: 'owner' } })
    mocks.classroomPalRequested.mockReturnValue(true)
    mocks.singleResults.push({ data: { ...classroom(), teacher_id: memberId }, error: null })
    await renderPage('daily')
    expect(mocks.contextualPal).not.toHaveBeenCalled()
    expect(mocks.legacyPal).not.toHaveBeenCalled()
    expect(screen.queryByTestId('membership-provider')).not.toBeInTheDocument()
  })

  it.each(['teacher', 'student'] as const)('offers legacy account Pal only to an admitted %s member with its existing student provider', async role => {
    prepareMember(role)
    await renderPage('today')
    expect(screen.getByTestId('classroom-page')).toHaveAttribute('data-pal', String(role === 'student'))
    expect(mocks.contextualPal).not.toHaveBeenCalled()
    expect(mocks.legacyPal).not.toHaveBeenCalled()
  })

  it('keeps academic work when current membership Pal resolution fails without legacy fallback', async () => {
    prepareMember('teacher')
    mocks.classroomPalRequested.mockReturnValue(true)
    mocks.contextualPal.mockRejectedValue(new Error('membership unavailable'))
    mocks.legacyPal.mockResolvedValue(scopedContext)
    await renderPage('today')
    expect(screen.getByTestId('classroom-page')).toHaveAttribute('data-pal', 'false')
    expect(screen.queryByTestId('membership-provider')).not.toBeInTheDocument()
    expect(mocks.legacyPal).not.toHaveBeenCalled()
  })

  it('preserves legacy membership Pal selection for unmatched admission', async () => {
    prepareMember('student')
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [] }))
    mocks.classroomPalRequested.mockReturnValue(true)
    mocks.legacyPal.mockResolvedValue(scopedContext)
    await renderPage('today')
    expect(mocks.legacyPal).toHaveBeenCalledExactlyOnceWith({ studentId: memberId, classroomId: 'classroom-1' })
    expect(mocks.contextualPal).not.toHaveBeenCalled()
  })

  it('rejects malformed Test admission before service construction or page relationship resolution', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', role: 'teacher' })
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '')
    await expect(renderPage('tests')).rejects.toThrow('admission configuration')
    expect(mocks.serviceConstructed).not.toHaveBeenCalled()
    expect(mocks.resolvePageAccess).not.toHaveBeenCalled()
  })

  it.each([undefined, JSON.stringify({ version: 1, admittedUserIds: [] })])('preserves existing Test mode for absent/unmatched admission %s', async (configuration) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', configuration)
    mocks.getCurrentUser.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', role: 'teacher' })
    mocks.singleResults.push({ data: classroom(), error: null })
    await renderPage('tests')
    expect(screen.getByTestId('classroom-page')).toHaveAttribute('data-test-experience', 'existing')
    expect(screen.getByTestId('classroom-page')).toHaveAttribute('data-classroom-role', 'teacher')
  })

  it.each(['teacher', 'student'] as const)('seeds the %s classroom header at the server owner', async (role) => {
    const serverNow = Date.parse('2026-10-05T16:00:00Z')
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(serverNow)
    try {
      mocks.getCurrentUser.mockResolvedValue({ id: `${role}-1`, email: `${role}@example.test`, role })
      mocks.singleResults.push({ data: classroom(), error: null })
      if (role === 'student') mocks.singleResults.push({ data: { classroom_id: 'classroom-1' }, error: null })
      await renderPage(role === 'teacher' ? 'daily' : 'today')
      expect(screen.getByTestId('classroom-page')).toHaveAttribute('data-initial-now', String(serverNow))
    } finally {
      dateNow.mockRestore()
    }
  })

  it('supplies stable poster availability for an attendance-enabled teacher', async () => {
    const classroomId = '11111111-1111-4111-8111-111111111111'
    const teacherId = '22222222-2222-4222-8222-222222222222'
    mocks.getCurrentUser.mockResolvedValue({ id: teacherId, email: 'teacher@example.test', role: 'teacher' })
    mocks.getAttendanceAccess.mockResolvedValue({ state: 'ready', scheduleThrough: null })
    mocks.singleResults.push({ data: { ...classroom(), id: classroomId, teacher_id: teacherId }, error: null })
    render(await ClassroomPage({ params: Promise.resolve({ classroomId }), searchParams: Promise.resolve({ tab: 'daily' }) }))
    expect(screen.getByTestId('classroom-page')).toHaveAttribute('data-classroom-qr', 'true')
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

  it.each(['legacy', 'contextual'] as const)('removes private guidance provenance before %s member client props', async (mode) => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'student-1', email: 'student@example.test', role: 'student' })
    mocks.resolvePageAccess.mockResolvedValue(mode === 'legacy' ? { mode } : { mode, context: { relationship: 'member' } })
    mocks.singleResults.push(
      { data: { classroom_id: 'classroom-1' }, error: null },
      { data: { ...classroom(), source_blueprint_version_id: 'content-v3',
        authoring_guidance_version_id: 'private-guidance-v4' }, error: null },
    )
    await renderPage('today')
    const record = mocks.clientProps.mock.lastCall?.[0]
    expect(record.source_blueprint_version_id).toBe('content-v3')
    expect(record).not.toHaveProperty('authoring_guidance_version_id')
    expect(JSON.stringify(record)).not.toContain('private-guidance-v4')
  })

  it('renders a student-valued owner with the teacher classroom experience only', async () => {
    const ownerId = '22222222-2222-4222-8222-222222222222'
    const classroomId = '11111111-1111-4111-8111-111111111111'
    mocks.getCurrentUser.mockResolvedValue({
      id: ownerId,
      email: 'owner@example.test',
      role: 'student',
    })
    mocks.resolvePageAccess.mockResolvedValue({
      mode: 'contextual',
      context: {
        userId: ownerId,
        classroomId,
        ownerId,
        relationship: 'owner',
        archived: false,
      },
    })
    mocks.singleResults.push({
      data: { ...classroom(), id: classroomId, teacher_id: ownerId },
      error: null,
    })

    render(await ClassroomPage({
      params: Promise.resolve({ classroomId }),
      searchParams: Promise.resolve({ tab: 'daily' }),
    }))

    expect(screen.getByTestId('classroom-page')).toHaveAttribute('data-role', 'student')
    expect(screen.getByTestId('classroom-page')).toHaveAttribute('data-classroom-role', 'teacher')
    expect(mocks.listActiveTeacherClassrooms).not.toHaveBeenCalled()
  })

  it('renders a teacher-valued member with the student classroom experience only', async () => {
    const memberId = '22222222-2222-4222-8222-222222222222'
    const ownerId = '33333333-3333-4333-8333-333333333333'
    const classroomId = '11111111-1111-4111-8111-111111111111'
    mocks.getCurrentUser.mockResolvedValue({
      id: memberId,
      email: 'member@example.test',
      role: 'teacher',
    })
    mocks.resolvePageAccess.mockResolvedValue({
      mode: 'contextual',
      context: {
        userId: memberId,
        classroomId,
        ownerId,
        relationship: 'member',
        archived: false,
      },
    })
    mocks.singleResults.push(
      { data: { classroom_id: classroomId }, error: null },
      { data: { ...classroom(), id: classroomId, teacher_id: ownerId }, error: null },
    )

    render(await ClassroomPage({
      params: Promise.resolve({ classroomId }),
      searchParams: Promise.resolve({ tab: 'today' }),
    }))

    expect(screen.getByTestId('classroom-page')).toHaveAttribute('data-role', 'teacher')
    expect(screen.getByTestId('classroom-page')).toHaveAttribute('data-classroom-role', 'student')
  })
})
