import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
    expect(screen.getByRole('heading', { name: 'Course guide' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Course outline' })).toBeNull()
    expect(screen.queryByText(/Sep 3.*Jan 29/)).toBeNull()
    expect(screen.queryByText('Semester 1')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Resources' })).toBeNull()
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

  it('does not render the legacy Resources section', () => {
    render(<CourseGuideView guide={{
      ...guide,
      visibility: { ...guide.visibility, resources: true },
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

  it('renders the document editor directly in teacher edit mode', () => {
    render(<CourseGuideView
      guide={{ ...guide, overviewMarkdown: '', resourcesContent: null }}
      embedded
      editMode
      overviewEditor={<div>Overview editor</div>}
    />)

    expect(screen.getByText('Overview editor')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Resources' })).toBeNull()
    expect(screen.queryByText('Course guide details are being prepared.')).toBeNull()
  })
})
