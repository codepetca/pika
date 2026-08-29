import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UiGallery } from '@/app/__ui/UiGallery'

vi.mock('@/components/HistoryGraph', () => ({
  HistoryGraph: ({ entries, hoverEnabled = true, onEntryClick, onEntryHover, showHeading }: any) => {
    if (entries.length === 0) return <div data-testid="empty-history" />

    return (
      <div>
        {[entries[entries.length - 1], entries[0]].map((historyEntry, index) => (
          <button
            key={historyEntry.id}
            type="button"
            aria-label="History point"
            data-history-position={index === 0 ? 'earliest' : 'latest'}
            data-entry-count={entries.length}
            data-hover-enabled={hoverEnabled ? 'yes' : 'no'}
            data-show-heading={showHeading === false ? 'no' : 'yes'}
            onMouseEnter={() => hoverEnabled && onEntryHover?.(historyEntry)}
            onClick={() => onEntryClick(historyEntry)}
          >
            Saved point
          </button>
        ))}
      </div>
    )
  },
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
    const [previewPoint, latestPreviewPoint] = screen.getAllByRole('button', {
      name: 'History point',
    })
    expect(screen.getByTestId('teacher-preview-mode')).toHaveTextContent('current')
    expect(screen.getByTestId('teacher-preview-mode')).toHaveAttribute('data-content-blocks', '41')
    expect(previewPoint).toHaveAttribute('data-show-heading', 'no')
    expect(Number(previewPoint.getAttribute('data-entry-count'))).toBeGreaterThan(100)
    expect(screen.getByText(/six-week project/i)).toBeInTheDocument()
    expect(screen.getByText(/two-week project/i)).toBeInTheDocument()
    expect(screen.getByText(/final-day crunch/i)).toBeInTheDocument()

    fireEvent.mouseEnter(previewPoint)
    expect(screen.getByTestId('teacher-preview-mode')).toHaveTextContent('fit')
    expect(screen.getByTestId('teacher-preview-mode')).toHaveAttribute('data-content-blocks', '2')

    fireEvent.mouseEnter(latestPreviewPoint)
    expect(screen.getByTestId('teacher-preview-mode')).toHaveAttribute('data-content-blocks', '41')

    await user.click(latestPreviewPoint)
    expect(screen.getByTestId('teacher-preview-mode')).toHaveTextContent('locked')
    expect(latestPreviewPoint).toHaveAttribute('data-hover-enabled', 'no')

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
    expect(screen.getByTestId('student-preview-mode')).toHaveAttribute('data-content-blocks', '2')

    fireEvent.click(previewPoint)
    expect(screen.getByTestId('student-preview-mode')).toHaveTextContent('locked')
  })
})
