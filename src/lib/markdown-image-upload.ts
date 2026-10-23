import { uploadFileDirectly } from '@/lib/direct-storage-upload'
import { getMarkdownImageValidationError } from '@/lib/markdown-images'

/** Return a durable authorized route; signed Storage URLs never enter Markdown. */
export async function uploadMarkdownImage(classroomId: string, file: File, signal?: AbortSignal): Promise<string> {
  const error = getMarkdownImageValidationError(file)
  if (error) throw new Error(error)
  signal?.throwIfAborted()
  const result = await uploadFileDirectly<{ url: string }>({
    endpoint: '/api/teacher/authoring-images', file, metadata: { classroom_id: classroomId }, signal,
  })
  signal?.throwIfAborted()
  if (typeof result.url !== 'string' || !/^\/api\/storage\/authoring-images\?object_id=[\da-f-]+$/i.test(result.url)) throw new Error('Image upload returned an invalid reference')
  return result.url
}
