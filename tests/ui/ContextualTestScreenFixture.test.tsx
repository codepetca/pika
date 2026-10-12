import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fixture from '@/app/e2e-fixtures/teacher-student-tables/page'

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  notFound: vi.fn(() => { throw new Error('not found') }),
}))
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }))
vi.mock('@/app/classrooms/[classroomId]/ClassroomPageClient', () => ({
  ClassroomPageClient: (props: unknown) => { mocks.client(props); return null },
}))
vi.mock('@/components/layout', () => ({
  LayoutInitialStateProvider: ({ children }: { children: unknown }) => children,
}))
vi.mock('@/app/e2e-fixtures/teacher-student-tables/course-guide-continuity', () => ({
  CourseGuideContinuityFixture: () => null,
}))

async function props(query: Record<string, string | undefined>) {
  const { render } = await import('@testing-library/react')
  render(await Fixture({ searchParams: Promise.resolve(query) }))
  return mocks.client.mock.calls.at(-1)![0]
}

describe('existing table fixture contextual Test screen options', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('PIKA_E2E_FIXTURES', 'true')
  })
  afterEach(() => vi.unstubAllEnvs())

  it.each(['teacher', 'student'])('renders a synthetic %s-role owner without changing account role', async role => {
    const result = await props({ role, relationship: 'owner', testExperience: 'shared', tab: 'tests' })
    expect(result.user.role).toBe(role)
    expect(result.user.id).toBe(result.classroom.teacher_id)
    expect(result.classroomRole).toBe('teacher')
    expect(result.testExperienceMode).toBe('shared')
    expect(result.teacherClassrooms).toEqual([result.classroom])
  })

  it.each(['teacher', 'student'])('renders a synthetic %s-role member without granting owner experience', async role => {
    const result = await props({ role, relationship: 'member', testExperience: 'shared', tab: 'tests' })
    expect(result.user.role).toBe(role)
    expect(result.user.id).not.toBe(result.classroom.teacher_id)
    expect(result.classroomRole).toBe('student')
    expect(result.teacherClassrooms).toEqual([])
  })

  it.each([undefined, 'invalid'])('preserves the existing fixture default for unknown relationship %#', async relationship => {
    const result = await props({ role: 'student', relationship, testExperience: 'invalid' })
    expect(result.classroomRole).toBe('student')
    expect(result.testExperienceMode).toBe('existing')
  })

  it.each(['production', 'development'])('rejects fixture outside explicit development E2E admission (%s)', async environment => {
    vi.stubEnv('NODE_ENV', environment)
    vi.stubEnv('PIKA_E2E_FIXTURES', environment === 'production' ? 'true' : 'false')
    await expect(props({ role: 'student', relationship: 'owner', testExperience: 'shared' })).rejects.toThrow('not found')
    expect(mocks.client).not.toHaveBeenCalled()
  })
})
