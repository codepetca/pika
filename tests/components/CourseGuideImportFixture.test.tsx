import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CourseGuideImportFixturePage from '@/app/e2e-fixtures/course-guide-import/page'

vi.mock('@/components/CourseGuidePanel', () => ({
  CourseGuidePanel: ({ role }: { role: 'teacher' | 'student' }) => (
    <div data-testid="course-guide-role">{role}</div>
  ),
}))

describe('Course Guide import visual fixture', () => {
  it('renders both teacher and student roles for the verification matrix', () => {
    const { rerender } = render(<CourseGuideImportFixturePage searchParams={{}} />)
    expect(screen.getByTestId('course-guide-role')).toHaveTextContent('teacher')

    rerender(<CourseGuideImportFixturePage searchParams={{ role: 'student' }} />)
    expect(screen.getByTestId('course-guide-role')).toHaveTextContent('student')
  })
})
