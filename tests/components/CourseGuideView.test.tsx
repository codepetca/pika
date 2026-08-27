import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CourseGuideView } from '@/components/CourseGuideView'
import type { CourseGuideData } from '@/lib/course-guide'

vi.mock('@/components/editor/RichTextViewer', () => ({
  RichTextViewer: ({ content }: { content: unknown }) => <div>Rich resource: {JSON.stringify(content)}</div>,
}))

const guide: CourseGuideData = {
  classroom: {
    title: 'Computer Science',
    classCode: 'ICS4U',
    termLabel: 'Semester 1',
    startDate: '2026-09-03',
    endDate: '2027-01-29',
  },
  visibility: {
    overview: true,
    outline: true,
    resources: true,
    assignments: true,
    tests: true,
    lesson_plans: true,
    announcements: true,
    lesson_plan_scope: 'current_week',
  },
  overviewMarkdown: 'Learn **software design**.',
  outlineMarkdown: '## Units\n\n- Programming\n- Projects',
  resourcesContent: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Course links' }] }],
  },
  assignments: [{
    key: 'assignment:0',
    title: 'Portfolio',
    instructionsMarkdown: 'Build a portfolio.',
    dueAt: '2026-10-15T03:59:00.000Z',
    pointsPossible: 30,
    includeInFinal: true,
    courseWeightPercent: 25,
    position: 0,
  }],
  tests: [{
    key: 'test:0',
    title: 'Programming Test',
    pointsPossible: 50,
    includeInFinal: true,
    courseWeightPercent: 75,
    position: 0,
    documents: [{ key: 'document:0', title: 'Review sheet', href: 'https://example.com/review' }],
  }],
  lessonPlans: [{
    key: 'lesson:2026-09-10',
    date: '2026-09-10',
    contentMarkdown: 'Variables and data types',
  }],
  announcements: [{
    key: 'announcement:1',
    title: 'Welcome',
    content: 'Bring your **laptop**.',
    publishedAt: '2026-09-01T14:00:00.000Z',
  }],
}

describe('CourseGuideView', () => {
  it('renders classroom content without a separate outline or course dates', () => {
    render(<CourseGuideView guide={guide} />)

    expect(screen.getByRole('heading', { level: 1, name: 'Computer Science' })).toBeInTheDocument()
    expect(screen.getByText(/ICS4U/)).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Course guide sections' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Assignments' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Tests' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Lessons' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Curriculum overview and expectations' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Course outline' })).toBeNull()
    expect(screen.queryByText(/Sep 3.*Jan 29/)).toBeNull()
    expect(screen.queryByText('Semester 1')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Resources' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Assignments' })).toBeInTheDocument()
    expect(screen.getByText('Portfolio')).toBeInTheDocument()
    expect(screen.getByText('Due Wed Oct 14')).toBeInTheDocument()
    expect(screen.getByText('30 points')).toBeInTheDocument()
    expect(screen.getByText('25% of course')).toBeInTheDocument()
    expect(screen.getByText('Build a portfolio.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Tests' })).toBeInTheDocument()
    expect(screen.getByText('Programming Test')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review sheet' })).toHaveAttribute('href', 'https://example.com/review')
    expect(screen.getByRole('heading', { name: 'Lesson sequence' })).toBeInTheDocument()
    expect(screen.queryByText('Thu Sep 10')).toBeNull()
    expect(screen.getByText('Variables and data types')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Announcements' })).toBeInTheDocument()
    expect(screen.getByText('Welcome')).toBeInTheDocument()
    expect(screen.getByText(/Bring your/)).toBeInTheDocument()
  })

  it('does not render a disabled section even when data exists', () => {
    render(<CourseGuideView guide={{
      ...guide,
      visibility: { ...guide.visibility, resources: false, lesson_plans: false },
    }} />)

    expect(screen.queryByRole('heading', { name: 'Resources' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Lesson sequence' })).toBeNull()
  })

  it('shows a calm published-empty state instead of a blank page', () => {
    render(<CourseGuideView guide={{
      ...guide,
      overviewMarkdown: '',
      outlineMarkdown: '',
      resourcesContent: null,
      assignments: [],
      tests: [],
      lessonPlans: [],
      announcements: [],
    }} />)

    expect(screen.getByText('Course guide details are being prepared.')).toBeInTheDocument()
  })

  it('exposes keyboard-clickable authored section headings only in teacher edit mode', () => {
    const onEditSection = vi.fn()
    render(<CourseGuideView
      guide={{ ...guide, overviewMarkdown: '', resourcesContent: null }}
      embedded
      editMode
      activeEditor="overview"
      onEditSection={onEditSection}
      overviewEditor={<div>Overview editor</div>}
      resourcesEditor={<div>Resources editor</div>}
    />)

    const overviewButton = screen.getByRole('button', { name: 'Edit curriculum overview and expectations' })
    expect(overviewButton).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Overview editor')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit resources' })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Edit resources' }))
    expect(onEditSection).toHaveBeenCalledWith('resources')
    expect(screen.queryByText('Course guide details are being prepared.')).toBeNull()
  })
})
