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
  HistoryGraph: ({ onEntryClick, onEntryHover }: any) => (
    <button
      type="button"
      aria-label="History point"
      onMouseEnter={() => onEntryHover?.(historyEntry)}
      onClick={() => onEntryClick(historyEntry)}
    >
      Saved point
    </button>
  ),
}))

vi.mock('@/components/editor', () => ({
  RichTextEditor: ({ historyPreviewMode }: any) => (
    <div data-testid="student-preview-mode">{historyPreviewMode}</div>
  ),
  RichTextViewer: ({ historyPreviewMode }: any) => (
    <div data-testid="teacher-preview-mode">{historyPreviewMode}</div>
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

    const previewPoint = screen.getAllByRole('button', { name: 'History point' })[0]
    expect(screen.getByTestId('teacher-preview-mode')).toHaveTextContent('current')

    fireEvent.mouseEnter(previewPoint)
    expect(screen.getByTestId('teacher-preview-mode')).toHaveTextContent('fit')

    await user.click(previewPoint)
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
