import { ApiError } from '@/lib/api-handler'

export const TEST_DOCUMENT_IMAGE_HEADER_MAX_BYTES = 64 * 1024
export const TEST_DOCUMENT_IMAGE_VALIDATION_TIMEOUT_MS = 5_000
const PNG_IHDR_FIXED_HEADER_BYTES = 33
export const TEST_DOCUMENT_IMAGE_MAX_DIMENSION = 10_000
export const TEST_DOCUMENT_IMAGE_MAX_PIXELS = 40_000_000

// This is deliberately a structural guard, not a full image decoder. It
// validates the declared format, signature, and dimensions from the first
// 64 KiB; malformed payloads beyond that window remain the renderer's concern.

type ImageDimensions = { width: number; height: number }

type ImageStorageClient = {
  storage: {
    from(bucket: 'test-documents'): {
      createSignedUrl(path: string, expiresIn: number): Promise<{
        data: { signedUrl: string } | null
        error: { message?: string } | null
      }>
    }
  }
}

function imageValidationError(message: string): never {
  throw new ApiError(400, message)
}

function validateDimensions({ width, height }: ImageDimensions): ImageDimensions {
  if (width < 1 || height < 1
    || width > TEST_DOCUMENT_IMAGE_MAX_DIMENSION
    || height > TEST_DOCUMENT_IMAGE_MAX_DIMENSION
    || width * height > TEST_DOCUMENT_IMAGE_MAX_PIXELS) {
    imageValidationError('Image dimensions exceed the supported limit')
  }
  return { width, height }
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function isValidPngColorDepth(bitDepth: number, colorType: number): boolean {
  if (colorType === 0) return [1, 2, 4, 8, 16].includes(bitDepth)
  if (colorType === 2 || colorType === 4 || colorType === 6) return [8, 16].includes(bitDepth)
  if (colorType === 3) return [1, 2, 4, 8].includes(bitDepth)
  return false
}

export function parsePngDimensions(bytes: Uint8Array): ImageDimensions {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < PNG_IHDR_FIXED_HEADER_BYTES
    || !signature.every((byte, index) => bytes[index] === byte)) {
    imageValidationError('Image is not a valid PNG')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ihdrLength = view.getUint32(8)
  if (ihdrLength !== 13
    || bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    imageValidationError('PNG header is invalid')
  }
  if (view.getUint32(29) !== crc32(bytes.subarray(12, 29))) {
    imageValidationError('PNG header checksum is invalid')
  }

  const bitDepth = bytes[24]
  const colorType = bytes[25]
  if (!isValidPngColorDepth(bitDepth, colorType)
    || bytes[26] !== 0 || bytes[27] !== 0 || ![0, 1].includes(bytes[28])) {
    imageValidationError('PNG image header fields are invalid')
  }

  return validateDimensions({
    width: view.getUint32(16),
    height: view.getUint32(20),
  })
}

function isJpegStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf
    && ![0xc4, 0xc8, 0xcc].includes(marker)
}

export function parseJpegDimensions(bytes: Uint8Array): ImageDimensions {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    imageValidationError('Image is not a valid JPEG')
  }

  let offset = 2
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) imageValidationError('JPEG header is invalid')
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) imageValidationError('JPEG header is incomplete')

    const marker = bytes[offset]
    offset += 1
    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) imageValidationError('JPEG header is incomplete')

    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1]
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      imageValidationError('JPEG header is incomplete')
    }
    if (isJpegStartOfFrame(marker)) {
      if (segmentLength < 8) imageValidationError('JPEG frame header is invalid')
      return validateDimensions({
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
      })
    }
    offset += segmentLength
  }

  imageValidationError('JPEG dimensions were not found in the validation header')
}

export function validateTestDocumentImageHeader(
  contentType: 'image/png' | 'image/jpeg',
  bytes: Uint8Array,
): ImageDimensions {
  return contentType === 'image/png'
    ? parsePngDimensions(bytes)
    : parseJpegDimensions(bytes)
}

async function readBoundedResponseBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) imageValidationError('Image validation read failed')

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      const remaining = maxBytes - total
      chunks.push(value.subarray(0, remaining))
      total += Math.min(value.byteLength, remaining)
      if (value.byteLength > remaining) break
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }

  const result = new Uint8Array(total)
  let cursor = 0
  for (const chunk of chunks) {
    result.set(chunk, cursor)
    cursor += chunk.byteLength
  }
  return result
}

export async function validateStoredTestDocumentImage(input: {
  supabase: ImageStorageClient
  path: string
  contentType: 'image/png' | 'image/jpeg'
}): Promise<ImageDimensions> {
  const { data, error } = await input.supabase.storage
    .from('test-documents')
    .createSignedUrl(input.path, 60)
  if (error || !data?.signedUrl) imageValidationError('Image validation read failed')

  let response: Response
  try {
    response = await fetch(data.signedUrl, {
      headers: { Range: `bytes=0-${TEST_DOCUMENT_IMAGE_HEADER_MAX_BYTES - 1}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(TEST_DOCUMENT_IMAGE_VALIDATION_TIMEOUT_MS),
    })
  } catch {
    imageValidationError('Image validation read failed')
  }
  if (!response.ok) imageValidationError('Image validation read failed')

  const bytes = await readBoundedResponseBytes(response, TEST_DOCUMENT_IMAGE_HEADER_MAX_BYTES)
  return validateTestDocumentImageHeader(input.contentType, bytes)
}
