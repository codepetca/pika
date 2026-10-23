import { sanitizeLinkHref } from '@/lib/tiptap-content'
import { IMAGE_ALLOWED_TYPES } from '@/lib/image-upload'

export const MARKDOWN_IMAGE_MAX_SIZE = 2 * 1024 * 1024
export const MARKDOWN_IMAGE_ACCEPT = IMAGE_ALLOWED_TYPES.join(',')
export type MarkdownImageUpload = (file: File, signal?: AbortSignal) => Promise<string>

export function getMarkdownImageValidationError(file: Pick<File, 'size' | 'type'>): string | null {
  if (!IMAGE_ALLOWED_TYPES.includes(file.type)) return 'Choose a PNG, JPEG, GIF, or WebP image.'
  if (file.size > MARKDOWN_IMAGE_MAX_SIZE) return 'Image must be 2 MB or smaller.'
  return null
}

/** Browser image sources only; ephemeral data/blob URLs must never enter stored Markdown. */
export function sanitizeMarkdownImageSrc(input: string): string | null {
  const value = String(input ?? '').trim()
  if (!value || /[\\\u0000-\u0020\u007f]/.test(value) || value.startsWith('//')) return null
  if (value.startsWith('/')) return value
  const sanitized = sanitizeLinkHref(value)
  if (!sanitized) return null
  try {
    const url = new URL(sanitized)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null
  } catch { return null }
}

export function escapeMarkdownImageText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]').replace(/[\r\n]/g, ' ')
}

export function unescapeMarkdownImageText(value: string): string {
  return value.replace(/\\([\\\[\]"()])/g, '$1')
}

/** Import in the browser so arbitrary URLs are never fetched by the Pika server. */
export async function fetchMarkdownImageFile(src: string, signal?: AbortSignal): Promise<File> {
  const safeSrc = sanitizeMarkdownImageSrc(src)
  if (!safeSrc) throw new Error('Enter a valid image URL.')
  let response: Response
  try {
    response = await fetch(safeSrc, { signal, mode: 'cors', credentials: 'same-origin' })
  } catch (cause) {
    if (signal?.aborted) throw cause
    throw new Error('This image URL cannot be imported. Download the image and choose Upload instead.')
  }
  if (!response.ok) throw new Error('We couldn’t load that image. Check the image URL or choose Upload.')
  const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  const declaredSize = Number(response.headers.get('content-length'))
  const invalid = getMarkdownImageValidationError({ type: mime, size: declaredSize })
  if (invalid) { await response.body?.cancel(); throw new Error(invalid) }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('This image URL cannot be imported. Choose Upload instead.')
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MARKDOWN_IMAGE_MAX_SIZE) throw new Error('Image must be 2 MB or smaller.')
      chunks.push(new Uint8Array(value))
    }
  } catch (cause) { await reader.cancel(); throw cause }
  finally { reader.releaseLock() }
  const extension = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1]
  return new File(chunks, `image.${extension}`, { type: mime })
}
