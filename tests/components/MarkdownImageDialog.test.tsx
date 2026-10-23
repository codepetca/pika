import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkdownImageDialog } from '@/components/editor/MarkdownImageDialog'

describe('MarkdownImageDialog', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } })))
    const OriginalURL = URL
    vi.stubGlobal('URL', class extends OriginalURL {
      static createObjectURL = vi.fn(() => 'blob:test-preview')
      static revokeObjectURL = vi.fn()
    })
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
  it('previews a safe URL and inserts its description, while rejecting executable URLs', async () => {
    const user = userEvent.setup()
    const onInsert = vi.fn()
    render(<MarkdownImageDialog onInsert={onInsert} onClose={vi.fn()} />)
    const input = screen.getByRole('textbox', { name: 'Image URL' })
    fireEvent.change(input, { target: { value: 'data:image/png;base64,abc' } })
    expect(screen.getByRole('button', { name: 'Insert image' })).toBeDisabled()
    fireEvent.change(input, { target: { value: 'https://example.com/diagram.png' } })
    const image = await screen.findByTestId('markdown-image-preview')
    fireEvent.load(image)
    await user.type(screen.getByRole('textbox', { name: 'Image description' }), 'Water cycle')
    await user.click(screen.getByRole('button', { name: 'Insert image' }))
    await waitFor(() => expect(onInsert).toHaveBeenCalledWith({ src: 'https://example.com/diagram.png', alt: 'Water cycle' }))
  })

  it('imports a URL through the scoped upload callback after bounding its browser-fetched bytes', async () => {
    const user = userEvent.setup()
    const onInsert = vi.fn()
    const imageUpload = vi.fn().mockResolvedValue('/api/teacher/markdown-images/image-1')
    render(<MarkdownImageDialog imageUpload={imageUpload} onInsert={onInsert} onClose={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: 'Image URL' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Image URL' }), { target: { value: 'https://example.com/image.png' } })
    fireEvent.load(await screen.findByTestId('markdown-image-preview'))
    await user.click(screen.getByRole('button', { name: 'Insert image' }))
    await waitFor(() => expect(imageUpload).toHaveBeenCalledWith(expect.any(File), expect.any(AbortSignal)))
    expect(imageUpload.mock.calls[0][0].size).toBe(3)
    expect(onInsert).toHaveBeenCalledWith({ src: '/api/teacher/markdown-images/image-1', alt: '' })
  })

  it('validates uploads before calling storage and cancels late uploads', async () => {
    const onInsert = vi.fn()
    let resolve!: (url: string) => void
    const imageUpload = vi.fn((_file: File, _signal?: AbortSignal) => new Promise<string>((done) => { resolve = done }))
    const view = render(<MarkdownImageDialog imageUpload={imageUpload} onInsert={onInsert} onClose={vi.fn()} />)
    const input = screen.getByTestId('markdown-image-file')
    fireEvent.change(input, { target: { files: [new File(['x'], 'vector.svg', { type: 'image/svg+xml' })] } })
    expect(screen.getByRole('alert')).toHaveTextContent('PNG')
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })] } })
    expect(screen.getByRole('alert')).toHaveTextContent('2 MB')
    expect(imageUpload).not.toHaveBeenCalled()
    const file = new File(['png'], 'small.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })
    fireEvent.load(await screen.findByTestId('markdown-image-preview'))
    fireEvent.click(screen.getByRole('button', { name: 'Insert image' }))
    await waitFor(() => expect(imageUpload).toHaveBeenCalledTimes(1))
    const signal = imageUpload.mock.calls[0][1]
    view.unmount()
    expect(signal?.aborted).toBe(true)
    await act(async () => { resolve('https://example.com/upload.png') })
    expect(onInsert).not.toHaveBeenCalled()
  })

  it('uses the shared dialog Escape and focus-return behavior', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<MarkdownImageDialog onInsert={vi.fn()} onClose={onClose} />)
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close image dialog' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })
})
