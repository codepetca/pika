import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { useHistoryPreviewViewport, type HistoryPreviewMode } from '@/hooks/useHistoryPreviewViewport'
import type { AssignmentHistoryChange } from '@/lib/assignment-doc-history'

function PreviewViewport({
  mode,
  contentKey,
  withImage = false,
  change = null,
}: {
  mode: HistoryPreviewMode
  contentKey: string
  withImage?: boolean
  change?: AssignmentHistoryChange | null
}) {
  const { viewportRef, minimapState } = useHistoryPreviewViewport(mode, contentKey, change)

  return (
    <div
      ref={viewportRef}
      data-testid="preview-viewport"
      data-history-preview-mode={mode}
    >
      <div className="tiptap ProseMirror">
        {withImage ? <img src="history-preview.png" alt="Saved diagram" /> : (
          <>
            <p data-offset-top="0" data-offset-height="80">Opening</p>
            <p data-offset-top="600" data-offset-height="80">Changed evidence</p>
            <p data-offset-top="1200" data-offset-height="80">Conclusion</p>
          </>
        )}
      </div>
      <output data-testid="minimap-state">{JSON.stringify(minimapState)}</output>
    </div>
  )
}

describe('useHistoryPreviewViewport', () => {
  let documentHeight = 1600
  let requestAnimationFrameSpy: ReturnType<typeof vi.spyOn>
  let cancelAnimationFrameSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    documentHeight = 1600
    requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        callback(0)
        return 1
      })
    cancelAnimationFrameSpy = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => undefined)

    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function () {
      return this.classList.contains('ProseMirror') ? 800 : 0
    })
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function () {
      if (this.classList.contains('ProseMirror')) return documentHeight
      return Number(this.dataset.offsetHeight || 0)
    })
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function () {
      return Number(this.dataset.offsetTop || 0)
    })
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function () {
      return this.classList.contains('ProseMirror') ? 800 : 0
    })
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function () {
      return this.classList.contains('ProseMirror') ? documentHeight : 0
    })
  })

  afterEach(() => {
    requestAnimationFrameSpy.mockRestore()
    cancelAnimationFrameSpy.mockRestore()
    vi.restoreAllMocks()
  })

  it('fits a transient preview, makes a pinned preview readable, and restores the prior view', () => {
    const { rerender } = render(
      <PreviewViewport mode="current" contentKey="draft" />,
    )
    const viewport = document.querySelector<HTMLElement>('[data-testid="preview-viewport"]')!
    viewport.scrollTop = 180
    viewport.scrollLeft = 24

    rerender(<PreviewViewport mode="fit" contentKey="save-1" />)

    expect(viewport.scrollTop).toBe(0)
    expect(viewport.scrollLeft).toBe(0)
    expect(viewport.style.getPropertyValue('--history-preview-scale')).toBe('0.25')

    rerender(<PreviewViewport mode="locked" contentKey="save-1" />)

    expect(viewport.style.getPropertyValue('--history-preview-scale')).toBe('1')
    expect(viewport.scrollTop).toBe(0)

    viewport.scrollTop = 320
    rerender(<PreviewViewport mode="current" contentKey="draft" />)

    expect(viewport.scrollTop).toBe(180)
    expect(viewport.scrollLeft).toBe(24)
  })

  it('remeasures image-backed previews after the image loads', () => {
    documentHeight = 800
    render(<PreviewViewport mode="fit" contentKey="save-with-image" withImage />)

    const viewport = document.querySelector<HTMLElement>('[data-testid="preview-viewport"]')!
    expect(viewport.style.getPropertyValue('--history-preview-scale')).toBe('0.5')

    documentHeight = 1600
    fireEvent.load(document.querySelector('img')!)

    expect(viewport.style.getPropertyValue('--history-preview-scale')).toBe('0.25')
  })

  it('focuses a newly selected pinned save on its changed block at normal scale', () => {
    const change: AssignmentHistoryChange = {
      changedBlocks: [{ index: 1, kind: 'added' }],
      deletionAnchors: [],
    }
    const { rerender } = render(
      <PreviewViewport mode="locked" contentKey="save-1" change={change} />,
    )
    const viewport = document.querySelector<HTMLElement>('[data-testid="preview-viewport"]')!
    viewport.scrollTop = 240

    rerender(<PreviewViewport mode="locked" contentKey="save-2" change={change} />)

    expect(viewport.scrollTop).toBe(488)
    expect(viewport.style.getPropertyValue('--history-preview-scale')).toBe('1')
    expect(document.querySelectorAll('[data-history-change-kind="added"]')).toHaveLength(1)
  })

  it('marks a deletion location and reports it in the minimap state', () => {
    const change: AssignmentHistoryChange = {
      changedBlocks: [],
      deletionAnchors: [{ index: 2, position: 'before', count: 1 }],
    }
    render(<PreviewViewport mode="focused" contentKey="save-deletion" change={change} />)

    const deletionAnchor = document.querySelector('[data-history-deletion-before="1"]')
    expect(deletionAnchor).toHaveTextContent('Conclusion')
    expect(document.querySelector('[data-testid="minimap-state"]')).toHaveTextContent('deleted')
  })
})
