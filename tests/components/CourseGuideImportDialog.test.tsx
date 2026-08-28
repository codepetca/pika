import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CourseGuideImportDialog } from '@/components/CourseGuideImportDialog'
import type { Classroom } from '@/types'

vi.mock('@/components/editor', () => ({
  ContentField: ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
    <div><span>{label}</span>{children}{hint ? <span>{hint}</span> : null}</div>
  ),
  MarkdownContentEditor: ({ markdown, onMarkdownChange, 'aria-label': ariaLabel }: {
    markdown: string
    onMarkdownChange: (value: string) => void
    'aria-label'?: string
  }) => (
    <textarea
      aria-label={ariaLabel}
      value={markdown}
      onChange={(event) => onMarkdownChange(event.target.value)}
    />
  ),
}))

const classroom = {
  id: 'classroom-1',
  title: 'Computer Studies',
  course_overview_markdown: 'Teacher-authored overview',
} as Classroom

const draft = {
  sourceTitle: 'Ontario Computer Studies curriculum',
  sourceUrl: 'https://example.ca/curriculum.pdf',
  sourceFilename: null,
  sourceLabel: '[Ontario Computer Studies curriculum](https://example.ca/curriculum.pdf)',
  overviewMarkdown: 'Imported overview',
  expectationsMarkdown: '- A1. Plan a project.',
  sourceLinks: [{ title: 'Source', url: 'https://example.ca/source' }],
  draftMarkdown: '## Curriculum overview\n\nImported overview',
  citationMarkdown: 'Source: [Ontario Computer Studies curriculum](https://example.ca/curriculum.pdf)',
}

function response(value: unknown, ok = true) {
  return Promise.resolve({
    ok,
    json: () => Promise.resolve(value),
  } as Response)
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('CourseGuideImportDialog', () => {
  it('requires source, editable review, and explicit confirmation before applying', async () => {
    const onApplied = vi.fn()
    const onClose = vi.fn()
    const updatedClassroom = {
      ...classroom,
      course_overview_markdown: 'Teacher-authored overview\n\n---\n\nReviewed import',
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(response({ draft, provenanceToken: 'p'.repeat(80) }))
      .mockReturnValueOnce(response({ classroom: updatedClassroom }))

    render(
      <CourseGuideImportDialog
        isOpen
        classroom={classroom}
        onApplied={onApplied}
        onClose={onClose}
      />,
    )

    expect(screen.getByText(/one-time draft/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Public URL' }))
    fireEvent.change(screen.getByLabelText('Public document URL'), {
      target: { value: 'https://example.ca/curriculum.pdf' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }))

    const editor = await screen.findByLabelText('Imported curriculum draft')
    expect(screen.getByText('Nothing has been added to the Course Guide yet.')).toBeInTheDocument()
    expect(onApplied).not.toHaveBeenCalled()
    fireEvent.change(editor, { target: { value: 'Reviewed import' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue to confirmation' }))

    expect(screen.getByText(/existing teacher content will remain unchanged/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add reviewed draft' }))

    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(updatedClassroom))
    const applyCall = fetchMock.mock.calls[1]
    expect(applyCall?.[0]).toBe('/api/teacher/classrooms/classroom-1/curriculum-import/apply')
    expect(JSON.parse(String((applyCall?.[1] as RequestInit).body))).toEqual({
      draftMarkdown: 'Reviewed import',
      expectedOverviewMarkdown: 'Teacher-authored overview',
      provenanceToken: 'p'.repeat(80),
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('shows extraction failures without offering review or apply', async () => {
    const onApplied = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockReturnValue(response({ error: 'Source could not be read' }, false))

    render(
      <CourseGuideImportDialog
        isOpen
        classroom={classroom}
        onApplied={onApplied}
        onClose={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Public URL' }))
    fireEvent.change(screen.getByLabelText('Public document URL'), {
      target: { value: 'https://example.ca/curriculum.pdf' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Source could not be read')
    expect(screen.queryByRole('button', { name: 'Add reviewed draft' })).toBeNull()
    expect(onApplied).not.toHaveBeenCalled()
  })

  it('does not carry a pending extraction draft into a different classroom', async () => {
    let resolveDraft!: (value: Response) => void
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise((resolve) => {
      resolveDraft = resolve
    }))
    const { rerender } = render(
      <CourseGuideImportDialog
        isOpen
        classroom={classroom}
        onApplied={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Public URL' }))
    fireEvent.change(screen.getByLabelText('Public document URL'), {
      target: { value: 'https://example.ca/curriculum.pdf' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }))

    rerender(
      <CourseGuideImportDialog
        isOpen
        classroom={{ ...classroom, id: 'classroom-2', title: 'Different classroom' }}
        onApplied={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    resolveDraft(await response({ draft, provenanceToken: 'p'.repeat(80) }))

    await waitFor(() => expect(screen.getByText(/one-time draft/i)).toBeInTheDocument())
    expect(screen.queryByText('Imported curriculum draft')).toBeNull()
    expect(screen.queryByText('Ontario Computer Studies curriculum')).toBeNull()
  })
})
