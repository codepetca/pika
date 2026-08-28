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
  },
  visibility: {
    overview: true,
    resources: true,
    assignments: true,
    tests: true,
  },
  overviewMarkdown: 'Learn **software design**.',
  resourcesContent: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Course links' }] }],
  },
  assignments: [{
    key: 'assignment:0',
    title: 'Portfolio',
  }],
  tests: [{
    key: 'test:0',
    title: 'Programming Test',
  }],
}

describe('CourseGuideView', () => {
  it('renders orientation content with compact title-only assessment lists', () => {
    render(<CourseGuideView guide={guide} />)

    expect(screen.getByRole('heading', { level: 1, name: 'Computer Science' })).toBeInTheDocument()
    expect(screen.queryByText(/ICS4U/)).toBeNull()
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
    expect(screen.getByRole('heading', { name: 'Tests' })).toBeInTheDocument()
    expect(screen.getByText('Programming Test')).toBeInTheDocument()
    expect(screen.getAllByRole('list')).toHaveLength(2)
    expect(screen.queryByText(/Due /)).toBeNull()
    expect(screen.queryByText(/points?/)).toBeNull()
    expect(screen.queryByText(/% of course/)).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Lesson sequence' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Announcements' })).toBeNull()
  })

  it('does not render a disabled guide section', () => {
    render(<CourseGuideView guide={{
      ...guide,
      visibility: { ...guide.visibility, resources: false },
    }} />)

    expect(screen.queryByRole('heading', { name: 'Resources' })).toBeNull()
  })

  it('shows a calm published-empty state instead of a blank page', () => {
    render(<CourseGuideView guide={{
      ...guide,
      overviewMarkdown: '',
      resourcesContent: null,
      assignments: [],
      tests: [],
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
