import type { ReactElement } from 'react'
import { TooltipProvider } from '@/ui'
import { fireEvent, render as rtlRender, screen } from '@testing-library/react'
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
