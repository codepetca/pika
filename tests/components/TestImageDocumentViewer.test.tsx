import type { ReactElement } from 'react'
import { TooltipProvider } from '@/ui'
import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TestImageDocumentViewer } from '@/components/TestImageDocumentViewer'

function render(ui: ReactElement) { return rtlRender(ui, { wrapper: TooltipProvider }) }

describe('TestImageDocumentViewer', () => {
  beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }) })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('shows a cached image that completed before hydration attached its load handler', () => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(800)
    vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(600)
    render(<TestImageDocumentViewer title="Cached world" url="/api/cached/file" />)
    expect(screen.queryByText('Loading image')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled()
  })
  it('loads with an accessible title and supports zoom and fit', () => {
    render(<TestImageDocumentViewer title="Start world" url="/api/start/file" />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading image')
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled()
    Object.defineProperties(screen.getByAltText('Start world'), { naturalWidth: { value: 800 }, naturalHeight: { value: 600 } })
    fireEvent.load(screen.getByAltText('Start world'))
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(screen.getByText('125%')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Fit image' }))
    expect(screen.getByText('Fit', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled()
  })

  it('keeps image dimensions stable when scrollbars change the content area', () => {
    let resize: (() => void) | undefined
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback }
      observe() {}
      disconnect() {}
    })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(416)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(301)
    const box = { width: 415.59375, height: 300.5 }
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      ...box, x: 0, y: 0, top: 0, left: 0, right: box.width, bottom: box.height,
      toJSON: () => ({}),
    }))
    render(<TestImageDocumentViewer title="Narrow world" url="/api/narrow/file" />)
    const image = screen.getByAltText('Narrow world')
    const viewport = screen.getByRole('region', { name: 'Narrow world image' })
    Object.defineProperties(image, { naturalWidth: { value: 800 }, naturalHeight: { value: 600 } })
    fireEvent.load(image)
    expect(parseFloat(image.style.width)).toBeCloseTo(300.5 * 800 / 600)
    expect(parseFloat(image.style.height)).toBeCloseTo(300.5)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    const zoomedWidth = image.style.width
    const zoomedHeight = image.style.height
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 399 },
      clientHeight: { configurable: true, value: 284 },
    })
    act(() => resize?.())
    expect(image.style.width).toBe(zoomedWidth)
    expect(image.style.height).toBe(zoomedHeight)
    // A genuine pane resize still recomputes Fit, retaining the selected zoom.
    box.width = 300.25
    act(() => resize?.())
    expect(parseFloat(image.style.width)).toBeCloseTo(300.25 * 1.25)
    fireEvent.click(screen.getByRole('button', { name: 'Fit image' }))
    expect(parseFloat(image.style.width)).toBeCloseTo(300.25)
  })

  it('retries a failed image through the authorized endpoint', () => {
    render(<TestImageDocumentViewer title="End world" url="/api/end/file" />)
    fireEvent.error(screen.getByAltText('End world'))
    expect(screen.getByRole('alert')).toHaveTextContent('Image unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByAltText('End world')).toHaveAttribute('src', '/api/end/file?image_retry=1')
    expect(screen.getByRole('status')).toHaveTextContent('Loading image')
  })

  it('clears the previous image state when its source changes', () => {
    const { rerender } = render(<TestImageDocumentViewer title="Start world" url="/api/start/file" />)
    Object.defineProperties(screen.getByAltText('Start world'), { naturalWidth: { value: 800 }, naturalHeight: { value: 600 } })
    fireEvent.load(screen.getByAltText('Start world'))
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    rerender(<TestImageDocumentViewer title="End world" url="/api/end/file" />)
    expect(screen.queryByText('125%')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Loading image')
    expect(screen.getByAltText('End world')).toHaveAttribute('src', '/api/end/file')
  })
})
