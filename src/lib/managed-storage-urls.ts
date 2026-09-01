const PUBLIC_STORAGE_MARKER = '/storage/v1/object/public/'

export type ManagedSubmissionImageReference = {
  managed_object_id?: string | null
  storage_bucket?: string | null
  storage_path?: string | null
  src?: string | null
}

export function parsePublicStoragePath(
  value: string | null | undefined,
  expectedBucket: 'submission-images' | 'test-documents',
): string | null {
  if (!value) return null

  try {
    const parsed = new URL(value)
    const marker = `${PUBLIC_STORAGE_MARKER}${expectedBucket}/`
    if (!parsed.pathname.startsWith(marker)) return null
    const path = decodeURIComponent(parsed.pathname.slice(marker.length))
    if (!path || path.startsWith('/') || path.includes('\0')) return null
    return path
  } catch {
    return null
  }
}

export function getProtectedSubmissionImageUrl(
  reference: ManagedSubmissionImageReference,
): string | null {
  const objectId = reference.managed_object_id?.trim()
  if (objectId) {
    return `/api/storage/submission-images?object_id=${encodeURIComponent(objectId)}`
  }

  const path = reference.storage_bucket === 'submission-images'
    ? reference.storage_path?.trim() || null
    : parsePublicStoragePath(reference.src, 'submission-images')
  if (!path) return reference.src || null

  return `/api/storage/submission-images?path=${encodeURIComponent(path)}`
}
