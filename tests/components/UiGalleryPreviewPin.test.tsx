import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UiGallery } from '@/app/__ui/UiGallery'
import type { RichTextEditorProps, RichTextViewerProps } from '@/components/editor'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { TooltipProvider } from '@/ui'

// Keep the gallery and HistoryGraph real; only replace the heavy document renderers.
// This CPU regression does not establish native browser or visual verification.
vi.mock('@/components/editor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/editor')>()),
  RichTextEditor: ({ content, historyPreviewMode, historyPreviewChange }: RichTextEditorProps) => (
    <div
      data-testid="student-preview-mode"
      data-content={JSON.stringify(content)}
      data-content-blocks={content?.content?.length ?? 0}
      data-changed-blocks={historyPreviewChange?.changedBlocks.length ?? 0}
    >
      {historyPreviewMode}
    </div>
  ),
  RichTextViewer: ({ content, historyPreviewMode, historyPreviewChange }: RichTextViewerProps) => (
    <div
      data-testid="teacher-preview-mode"
      data-content={JSON.stringify(content)}
      data-content-blocks={content?.content?.length ?? 0}
      data-changed-blocks={historyPreviewChange?.changedBlocks.length ?? 0}
    >
      {historyPreviewMode}
    </div>
  ),
}))

describe('UiGallery real history graph preview pinning', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ classrooms: [] }),
    })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(['teacher', 'student'] as const)(
    'keeps the %s third-save preview pinned after keyboard selection and mouseleave until Exit preview is clicked',
    async (role) => {
      const user = userEvent.setup()
      render(<ThemeProvider><TooltipProvider><UiGallery role={role} /></TooltipProvider></ThemeProvider>)
      const preview = within(screen.getByTestId('history-preview-gallery'))
      const documentPreview = preview.getByTestId(`${role}-preview-mode`)
      const graph = preview.getByRole('slider', { name: 'Complete save history' })

      expect(documentPreview).toHaveTextContent(/^focused$/)
      expect(documentPreview).toHaveAttribute('data-content-blocks', '23')
      expect(documentPreview).toHaveAttribute('data-changed-blocks', '14')
      expect(graph).toHaveAttribute('aria-valuenow', '3')
      const thirdSaveContent = documentPreview.getAttribute('data-content')

      fireEvent.mouseLeave(graph)

      expect(documentPreview).toHaveTextContent(/^current$/)
      expect(documentPreview).toHaveAttribute('data-content-blocks', '41')
      expect(documentPreview).toHaveAttribute('data-changed-blocks', '0')
      expect(preview.queryByRole('button', { name: 'Exit preview' })).not.toBeInTheDocument()

      graph.focus()
      expect(graph).toHaveFocus()
      await user.keyboard('{Home}{ArrowRight}{ArrowRight}')

      expect(graph).toHaveAttribute('aria-valuenow', '3')
      expect(documentPreview).toHaveTextContent(/^locked$/)
      expect(documentPreview).toHaveAttribute('data-content-blocks', '23')
      expect(documentPreview).toHaveAttribute('data-changed-blocks', '14')
      expect(documentPreview).toHaveAttribute('data-content', thirdSaveContent)

      fireEvent.mouseLeave(graph)

      expect(graph).toHaveAttribute('aria-valuenow', '3')
      expect(documentPreview).toHaveTextContent(/^locked$/)
      expect(documentPreview).toHaveAttribute('data-content', thirdSaveContent)
      expect(documentPreview).toHaveAttribute('data-content-blocks', '23')
      expect(documentPreview).toHaveAttribute('data-changed-blocks', '14')

      await user.click(preview.getByRole('button', { name: 'Exit preview' }))

      expect(documentPreview).toHaveTextContent(/^current$/)
      expect(documentPreview).toHaveAttribute('data-content-blocks', '41')
      expect(documentPreview).toHaveAttribute('data-changed-blocks', '0')
      expect(preview.queryByRole('button', { name: 'Exit preview' })).not.toBeInTheDocument()
    },
  )
})
