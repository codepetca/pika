import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CourseGuideImportFixturePage from '@/app/e2e-fixtures/course-guide-import/page'

vi.mock('@/components/CourseGuidePanel', () => ({
  CourseGuidePanel: ({ role }: { role: 'teacher' | 'student' }) => (
    <div data-testid="course-guide-role">{role}</div>
  ),
}))

vi.mock('@/components/CourseGuideView', () => ({
  CourseGuideView: ({ guide }: { guide: { assignments: Array<{ title: string }>; tests: Array<{ title: string }> } }) => (
    <div data-testid="public-course-guide">
      {guide.assignments[0]?.title} · {guide.tests[0]?.title}
    </div>
  ),
}))

describe('Course Guide import visual fixture', () => {
  it('renders teacher, student, and public roles for the verification matrix', () => {
    const { rerender } = render(<CourseGuideImportFixturePage searchParams={{}} />)
    expect(screen.getByTestId('course-guide-role')).toHaveTextContent('teacher')

    rerender(<CourseGuideImportFixturePage searchParams={{ role: 'student' }} />)
    expect(screen.getByTestId('course-guide-role')).toHaveTextContent('student')

    rerender(<CourseGuideImportFixturePage searchParams={{ role: 'public' }} />)
    expect(screen.getByTestId('public-course-guide')).toHaveTextContent(
      'Design portfolio · Programming concepts test',
    )
  })
})
