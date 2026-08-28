import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UiGallery } from '@/app/__ui/UiGallery'

const historyEntry = {
  id: 'save-1',
  assignment_doc_id: 'doc-1',
  patch: null,
  snapshot: null,
  word_count: 10,
  char_count: 50,
  paste_word_count: null,
  keystroke_count: null,
  trigger: 'autosave',
  created_at: '2026-08-27T12:00:00Z',
}

vi.mock('@/components/HistoryGraph', () => ({
  HistoryGraph: ({ entries, hoverEnabled = true, onEntryClick, onEntryHover, showHeading }: any) => (
    <button
      type="button"
      aria-label="History point"
      data-entry-count={entries.length}
      data-hover-enabled={hoverEnabled ? 'yes' : 'no'}
      data-show-heading={showHeading === false ? 'no' : 'yes'}
      onMouseEnter={() => hoverEnabled && onEntryHover?.(historyEntry)}
      onClick={() => onEntryClick(historyEntry)}
    >
      Saved point
    </button>
  ),
}))

vi.mock('@/components/editor', () => ({
  RichTextEditor: ({ content, historyPreviewMode }: any) => (
    <div data-testid="student-preview-mode" data-content-blocks={content.content.length}>
      {historyPreviewMode}
    </div>
  ),
  RichTextViewer: ({ content, historyPreviewMode }: any) => (
    <div data-testid="teacher-preview-mode" data-content-blocks={content.content.length}>
      {historyPreviewMode}
    </div>
  ),
}))

describe('UiGallery history preview fixture', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ classrooms: [] }),
    })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('demonstrates teacher hover, pin, and exit states', async () => {
    const user = userEvent.setup()
    render(<UiGallery role="teacher" />)

    expect(screen.getByText(/additions and deletions across the actual activity days/i)).toBeInTheDocument()
    const previewPoint = screen.getAllByRole('button', { name: 'History point' })[0]
    expect(screen.getByTestId('teacher-preview-mode')).toHaveTextContent('current')
    expect(screen.getByTestId('teacher-preview-mode')).toHaveAttribute('data-content-blocks', '41')
    expect(previewPoint).toHaveAttribute('data-show-heading', 'no')
    expect(Number(previewPoint.getAttribute('data-entry-count'))).toBeGreaterThan(100)
    expect(screen.getByText(/six-week project/i)).toBeInTheDocument()
    expect(screen.getByText(/two-week project/i)).toBeInTheDocument()
    expect(screen.getByText(/final-day crunch/i)).toBeInTheDocument()

    fireEvent.mouseEnter(previewPoint)
    expect(screen.getByTestId('teacher-preview-mode')).toHaveTextContent('fit')

    await user.click(previewPoint)
    expect(screen.getByTestId('teacher-preview-mode')).toHaveTextContent('locked')
    expect(previewPoint).toHaveAttribute('data-hover-enabled', 'no')

    fireEvent.mouseEnter(previewPoint)
    expect(screen.getByTestId('teacher-preview-mode')).toHaveTextContent('locked')

    await user.click(screen.getByRole('button', { name: 'Exit preview' }))
    expect(screen.getByTestId('teacher-preview-mode')).toHaveTextContent('current')
  })

  it('uses the same preview lifecycle for the student surface', () => {
    render(<UiGallery role="student" />)

    const previewPoint = screen.getAllByRole('button', { name: 'History point' })[0]
    expect(screen.getByTestId('student-preview-mode')).toHaveTextContent('current')

    fireEvent.mouseEnter(previewPoint)
    expect(screen.getByTestId('student-preview-mode')).toHaveTextContent('fit')

    fireEvent.click(previewPoint)
    expect(screen.getByTestId('student-preview-mode')).toHaveTextContent('locked')
  })
})
