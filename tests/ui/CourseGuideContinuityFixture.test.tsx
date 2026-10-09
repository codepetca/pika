import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CourseGuideFixturePage from '@/app/e2e-fixtures/teacher-student-tables/page'
import { CourseGuideContinuityFixture } from '@/app/e2e-fixtures/teacher-student-tables/course-guide-continuity'
import { LayoutInitialStateProvider } from '@/components/layout'
import { ClassroomPageClient } from '@/app/classrooms/[classroomId]/ClassroomPageClient'

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('fixture not found') } }))
vi.mock('@/app/classrooms/[classroomId]/ClassroomPageClient', () => ({ ClassroomPageClient: () => null }))
vi.mock('@/app/e2e-fixtures/teacher-student-tables/course-guide-continuity', () => ({ CourseGuideContinuityFixture: () => null }))
vi.mock('@/components/layout', () => ({ LayoutInitialStateProvider: () => null }))

const page = (guideContinuity?: string) => CourseGuideFixturePage({ searchParams: Promise.resolve({ role: 'student', guideContinuity }) })

describe('Course Guide continuity fixture gate', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('PIKA_E2E_FIXTURES', 'true')
  })
  afterEach(() => { vi.unstubAllEnvs() })

  it('keeps the default actual classroom fixture without continuity controls', async () => {
    const result = await page()
    expect(result.type).toBe(LayoutInitialStateProvider)
    expect(result.props.children.type).toBe(ClassroomPageClient)
    expect(result.props.children.props.classroomRole).toBe('student')
  })

  it('requires the explicit query opt-in for continuity controls', async () => {
    const result = await page('true')
    expect(result.props.children.type).toBe(CourseGuideContinuityFixture)
    expect(result.props.children.props.initialRole).toBe('student')
    expect((await page('false')).props.children.type).toBe(ClassroomPageClient)
  })

  it('rejects opted-in controls when the development fixture flag is absent', async () => {
    vi.stubEnv('PIKA_E2E_FIXTURES', 'false')
    await expect(page('true')).rejects.toThrow('fixture not found')
  })

  it('rejects opted-in controls in production even with the fixture flag', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    await expect(page('true')).rejects.toThrow('fixture not found')
  })
})
