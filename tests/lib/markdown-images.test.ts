import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchMarkdownImageFile, MARKDOWN_IMAGE_MAX_SIZE, sanitizeMarkdownImageSrc } from '@/lib/markdown-images'

afterEach(() => vi.unstubAllGlobals())

describe('Markdown image sources', () => {
  it.each(['//host/image.png', 'data:image/png;base64,abc', 'blob:https://example.com/a', 'javascript:evil', 'mailto:a@example.com', '/\\host/image.png', 'https://user:pass@example.com/image'])('rejects unsafe source %s', (src) => {
    expect(sanitizeMarkdownImageSrc(src)).toBeNull()
  })
  it('accepts protected same-origin and sanitized HTTPS image sources', () => {
    expect(sanitizeMarkdownImageSrc('/api/teacher/images?id=1')).toBe('/api/teacher/images?id=1')
    expect(sanitizeMarkdownImageSrc('https://example.com/image.png')).toBe('https://example.com/image.png')
  })
  it('bounds streamed remote content even when Content-Length is missing', async () => {
    const cancel = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'image/png' }), body: new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(MARKDOWN_IMAGE_MAX_SIZE + 1)) }, cancel,
    }) }))
    await expect(fetchMarkdownImageFile('https://example.com/image.png')).rejects.toThrow('2 MB')
    expect(cancel).toHaveBeenCalledOnce()
  })
  it('returns a file for managed upload without server-side fetching', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }))
    vi.stubGlobal('fetch', fetcher)
    const file = await fetchMarkdownImageFile('https://example.com/image.png')
    expect(file.size).toBe(3)
    expect(file.type).toBe('image/png')
    expect(fetcher).toHaveBeenCalledWith('https://example.com/image.png', expect.objectContaining({ mode: 'cors', credentials: 'same-origin' }))
  })
  it('turns CORS failures into an actionable upload alternative', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(fetchMarkdownImageFile('https://example.com/image.png')).rejects.toThrow('choose Upload')
  })
})
