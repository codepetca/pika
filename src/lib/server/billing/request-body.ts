import type { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-handler'

export async function readBillingJsonBody(request: NextRequest): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new ApiError(415, 'Expected JSON request')
  const reader = request.body?.getReader()
  if (!reader) throw new ApiError(400, 'Missing request body')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 4096) { await reader.cancel(); throw new ApiError(413, 'Request body is too large') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new ApiError(400, 'Malformed JSON body') }
}
