import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { useHistoryPreviewViewport, type HistoryPreviewMode } from '@/hooks/useHistoryPreviewViewport'

function PreviewViewport({
  mode,
  contentKey,
  withImage = false,
}: {
  mode: HistoryPreviewMode
  contentKey: string
  withImage?: boolean
}) {
  const viewportRef = useHistoryPreviewViewport(mode, contentKey)

  return (
    <div
      ref={viewportRef}
      data-testid="preview-viewport"
      data-history-preview-mode={mode}
    >
      <div className="tiptap ProseMirror">
        {withImage ? <img src="history-preview.png" alt="Saved diagram" /> : null}
      </div>
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
      return this.classList.contains('ProseMirror') ? documentHeight : 0
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

  it('returns a newly selected pinned save to the top at normal scale', () => {
    const { rerender } = render(
      <PreviewViewport mode="locked" contentKey="save-1" />,
    )
    const viewport = document.querySelector<HTMLElement>('[data-testid="preview-viewport"]')!
    viewport.scrollTop = 240

    rerender(<PreviewViewport mode="locked" contentKey="save-2" />)

    expect(viewport.scrollTop).toBe(0)
    expect(viewport.style.getPropertyValue('--history-preview-scale')).toBe('1')
  })
})
