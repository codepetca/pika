import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UiGallery } from '@/app/__ui/UiGallery'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { TooltipProvider } from '@/ui'

function renderGallery(role: 'teacher' | 'student') {
  return render(<ThemeProvider><TooltipProvider><UiGallery role={role} /></TooltipProvider></ThemeProvider>)
}

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
  RichTextEditor: ({ content, historyPreviewMode, historyPreviewChange }: any) => (
    <div
      data-testid="student-preview-mode"
      data-content-blocks={content.content.length}
      data-changed-blocks={historyPreviewChange?.changedBlocks.length ?? 0}
    >
      {historyPreviewMode}
    </div>
  ),
  RichTextViewer: ({ content, historyPreviewMode, historyPreviewChange }: any) => (
    <div
      data-testid="teacher-preview-mode"
      data-content-blocks={content.content.length}
      data-changed-blocks={historyPreviewChange?.changedBlocks.length ?? 0}
    >
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

  it('demonstrates the tall creation dialog and returns focus when dismissed', async () => {
    const user = userEvent.setup()
    renderGallery('teacher')
    const opener = screen.getByRole('button', { name: 'Open creation dialog' })
    await user.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Classwork creation example' })
    expect(dialog).toHaveClass('h-[90dvh]')
    expect(within(dialog).getByText('Example content section 24')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('demonstrates teacher hover, pin, and exit states', async () => {
    const user = userEvent.setup()
    renderGallery('teacher')

    expect(screen.getByText(/additions and deletions across the actual activity days/i)).toBeInTheDocument()
    const [previewPoint, latestPreviewPoint] = screen.getAllByRole('button', {
      name: 'History point',
    })
    expect(screen.getByTestId('teacher-preview-mode')).toHaveTextContent('focused')
    expect(screen.getByTestId('teacher-preview-mode')).toHaveAttribute('data-content-blocks', '22')
    expect(screen.getByTestId('teacher-preview-mode')).toHaveAttribute('data-changed-blocks', '13')
    expect(previewPoint).toHaveAttribute('data-show-heading', 'no')
    expect(previewPoint).toHaveAttribute('data-entry-count', '5')
    expect(screen.getByText(/six-week project/i)).toBeInTheDocument()
    expect(screen.getByText(/two-week project/i)).toBeInTheDocument()
    expect(screen.getByText(/final-day crunch/i)).toBeInTheDocument()

    fireEvent.mouseEnter(previewPoint)
    expect(screen.getByTestId('teacher-preview-mode')).toHaveTextContent('focused')
    expect(screen.getByTestId('teacher-preview-mode')).toHaveAttribute('data-content-blocks', '9')
    expect(screen.getByTestId('teacher-preview-mode')).toHaveAttribute('data-changed-blocks', '9')

    fireEvent.mouseEnter(latestPreviewPoint)
    expect(screen.getByTestId('teacher-preview-mode')).toHaveAttribute('data-content-blocks', '41')
    expect(screen.getByTestId('teacher-preview-mode')).toHaveAttribute('data-changed-blocks', '20')

    await user.click(latestPreviewPoint)
    expect(screen.getByTestId('teacher-preview-mode')).toHaveTextContent('locked')
    expect(latestPreviewPoint).toHaveAttribute('data-hover-enabled', 'no')

    fireEvent.mouseEnter(previewPoint)
    expect(screen.getByTestId('teacher-preview-mode')).toHaveTextContent('locked')

    await user.click(screen.getByRole('button', { name: 'Exit preview' }))
    expect(screen.getByTestId('teacher-preview-mode')).toHaveTextContent('current')
    expect(screen.getByTestId('teacher-preview-mode')).toHaveAttribute('data-content-blocks', '41')
    expect(screen.getByTestId('teacher-preview-mode')).toHaveAttribute('data-changed-blocks', '0')
  })

  it('uses the same preview lifecycle for the student surface', () => {
    renderGallery('student')
    expect(screen.queryByRole('button', { name: 'Open creation dialog' })).not.toBeInTheDocument()

    const previewPoint = screen.getAllByRole('button', { name: 'History point' })[0]
    expect(screen.getByTestId('student-preview-mode')).toHaveTextContent('focused')
    expect(screen.getByTestId('student-preview-mode')).toHaveAttribute('data-content-blocks', '22')
    expect(screen.getByTestId('student-preview-mode')).toHaveAttribute('data-changed-blocks', '13')

    fireEvent.mouseEnter(previewPoint)
    expect(screen.getByTestId('student-preview-mode')).toHaveTextContent('focused')
    expect(screen.getByTestId('student-preview-mode')).toHaveAttribute('data-content-blocks', '9')
    expect(screen.getByTestId('student-preview-mode')).toHaveAttribute('data-changed-blocks', '9')

    fireEvent.click(previewPoint)
    expect(screen.getByTestId('student-preview-mode')).toHaveTextContent('locked')
  })
})
