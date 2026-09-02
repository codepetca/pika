import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetPublishedPlannedCourseSite } = vi.hoisted(() => ({
  mockGetPublishedPlannedCourseSite: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('not found')
  }),
}))

vi.mock('@/lib/server/course-sites', () => ({
  buildMarkdownSectionContent: (markdown: string) => markdown,
  getPublishedPlannedCourseSite: mockGetPublishedPlannedCourseSite,
}))

vi.mock('@/components/editor/RichTextViewer', () => ({
  RichTextViewer: ({ content }: { content: string }) => <div>{content}</div>,
}))

import PlannedCourseSitePage from '@/app/planned/[slug]/page'

describe('PlannedCourseSitePage', () => {
  beforeEach(() => {
    mockGetPublishedPlannedCourseSite.mockResolvedValue({
      ok: true,
      site: {
        blueprint: {
          title: 'Computer Science 11',
          subject: 'Computer Science',
          grade_level: 'Grade 11',
          course_code: 'ICS3U',
          term_template: 'Semester 1',
          overview_markdown: 'Course overview',
          outline_markdown: 'Course outline',
          resources_markdown: 'Course resources',
          planned_site_config: {
            overview: true,
            outline: true,
            resources: true,
            assignments: true,
            tests: true,
            lesson_plans: true,
          },
          assignments: [{
            id: 'assignment-1',
            title: 'Algorithm Design Brief',
            instructions_markdown: 'Compare two algorithms.',
          }],
          assessments: [{
            assessment_type: 'test',
            title: 'Programming Foundations Test',
          }],
          lesson_templates: [{
            title: 'Tracing and Debugging',
            content_markdown: 'Trace one program.',
          }],
        },
      },
    })
  })

  it('exposes a semantic section index without rendering private Test content', async () => {
    const { container } = render(
      await PlannedCourseSitePage({ params: Promise.resolve({ slug: 'computer-science-11' }) }),
    )

    const sectionNavigation = screen.getByRole('navigation', { name: 'Course sections' })
    expect(sectionNavigation).toBeVisible()
    expect(screen.getByRole('link', { name: 'Overview', exact: true })).toHaveAttribute('href', '#overview')
    expect(screen.getByRole('link', { name: 'Tests', exact: true })).toHaveAttribute('href', '#tests')
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'Overview',
      'Outline',
      'Resources',
      'Assignments',
      'Tests',
      'Lesson Sequence',
    ])
    expect(screen.getByRole('heading', { level: 3, name: 'Programming Foundations Test' })).toBeVisible()
    expect(screen.queryByText(/questions?/i)).toBeNull()
    expect(screen.queryByText('Private question')).toBeNull()
    expect(screen.queryByText('Private answer')).toBeNull()
    expect(container.innerHTML).not.toContain('assignment-1')
    expect(container.innerHTML).not.toContain('test-1')
    expect(container.innerHTML).not.toContain('lesson-1')
  })
})
