import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  parseJpegDimensions,
  parsePngDimensions,
  TEST_DOCUMENT_IMAGE_HEADER_MAX_BYTES,
  validateStoredTestDocumentImage,
  validateTestDocumentImageHeader,
} from '@/lib/server/test-document-image-validation'

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

function pngHeader(
  width = 3,
  height = 2,
  options: { bitDepth?: number; colorType?: number } = {},
): Uint8Array {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  const view = new DataView(bytes.buffer)
  view.setUint32(8, 13)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  view.setUint32(16, width)
  view.setUint32(20, height)
  bytes[24] = options.bitDepth ?? 8
  bytes[25] = options.colorType ?? 2
  view.setUint32(29, crc32(bytes.subarray(12, 29)))
  return bytes
}

function jpegHeader(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0,
    0xff, 0xc0, 0, 8, 8,
    height >>> 8, height, width >>> 8, width, 3,
  ])
}

function storageClient() {
  const createSignedUrl = vi.fn(async () => ({
    data: { signedUrl: 'https://project.supabase.co/storage/v1/object/sign/test-documents/diagram.png?token=short-lived' },
    error: null,
  }))
  return {
    client: { storage: { from: vi.fn(() => ({ createSignedUrl })) } },
    createSignedUrl,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('test document image validation', () => {
  it('accepts a complete PNG IHDR chunk and reads its declared dimensions', () => {
    expect(parsePngDimensions(pngHeader())).toEqual({ width: 3, height: 2 })
  })

  it('requires the complete fixed PNG header, its checksum, and valid IHDR fields', () => {
    expect(() => parsePngDimensions(pngHeader().subarray(0, 24))).toThrow('valid PNG')

    const badChecksum = pngHeader()
    badChecksum[29] ^= 1
    expect(() => parsePngDimensions(badChecksum)).toThrow('checksum')

    expect(() => parsePngDimensions(pngHeader(3, 2, { bitDepth: 3 }))).toThrow('header fields')
  })

  it('accepts a JPEG SOF header and reads its declared dimensions', () => {
    const bytes = jpegHeader(3, 2)
    expect(parseJpegDimensions(bytes)).toEqual({ width: 3, height: 2 })
    expect(validateTestDocumentImageHeader('image/jpeg', bytes)).toEqual({ width: 3, height: 2 })
  })

  it('rejects truncated and oversized JPEG declarations', () => {
    expect(() => parseJpegDimensions(jpegHeader(3, 2).subarray(0, 12))).toThrow('incomplete')
    expect(() => parseJpegDimensions(jpegHeader(0, 2))).toThrow('dimensions exceed')
    expect(() => parseJpegDimensions(jpegHeader(8_000, 5_001))).toThrow('dimensions exceed')
  })

  it('cancels an oversized signed Storage response after the bounded header read', async () => {
    const { client, createSignedUrl } = storageClient()
    const body = new Uint8Array(TEST_DOCUMENT_IMAGE_HEADER_MAX_BYTES + 16)
    body.set(pngHeader())
    let canceled = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(body) },
      cancel() { canceled = true },
    })
    const fetchMock = vi.fn(async () => new Response(stream, { status: 206 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(validateStoredTestDocumentImage({
      supabase: client as any,
      path: 'classrooms/class/tests/test/documents/doc/diagram.png',
      contentType: 'image/png',
    })).resolves.toEqual({ width: 3, height: 2 })

    expect(canceled).toBe(true)
    expect(createSignedUrl).toHaveBeenCalledWith(
      'classrooms/class/tests/test/documents/doc/diagram.png',
      60,
    )
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: { Range: 'bytes=0-65535' },
      signal: expect.any(AbortSignal),
    }))
  })

  it('fails closed when the signed fetch fails or times out', async () => {
    const { client } = storageClient()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network unavailable') }))
    await expect(validateStoredTestDocumentImage({
      supabase: client as any,
      path: 'classrooms/class/tests/test/documents/doc/diagram.png',
      contentType: 'image/png',
    })).rejects.toThrow('Image validation read failed')

    const timeoutFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      throw new DOMException('The operation timed out', 'TimeoutError')
    })
    vi.stubGlobal('fetch', timeoutFetch)
    await expect(validateStoredTestDocumentImage({
      supabase: client as any,
      path: 'classrooms/class/tests/test/documents/doc/diagram.png',
      contentType: 'image/png',
    })).rejects.toThrow('Image validation read failed')
  })
})
