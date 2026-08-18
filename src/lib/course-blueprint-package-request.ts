import { ApiError } from '@/lib/api-handler'
import { COURSE_BLUEPRINT_PACKAGE_MAX_BYTES } from '@/lib/contracts/course-blueprint-package'

export async function readCourseBlueprintPackageBody(request: Request): Promise<Uint8Array> {
  const contentLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > COURSE_BLUEPRINT_PACKAGE_MAX_BYTES) {
    throw new ApiError(413, 'Course package exceeds the 8 MiB limit')
  }
  if (!request.body) return new Uint8Array()

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > COURSE_BLUEPRINT_PACKAGE_MAX_BYTES) {
        await reader.cancel()
        throw new ApiError(413, 'Course package exceeds the 8 MiB limit')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}
