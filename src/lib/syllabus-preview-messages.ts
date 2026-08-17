export const SYLLABUS_PREVIEW_READY = 'pika:syllabus-preview-ready'
export const SYLLABUS_PREVIEW_READY_REQUEST = 'pika:syllabus-preview-ready-request'

export type SyllabusPreviewReadyMessage = {
  type: typeof SYLLABUS_PREVIEW_READY
  href: string
}

export type SyllabusPreviewReadyRequest = {
  type: typeof SYLLABUS_PREVIEW_READY_REQUEST
}

export function isSyllabusPreviewReadyMessage(
  value: unknown,
): value is SyllabusPreviewReadyMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Record<string, unknown>
  return message.type === SYLLABUS_PREVIEW_READY && typeof message.href === 'string'
}

export function isSyllabusPreviewReadyRequest(
  value: unknown,
): value is SyllabusPreviewReadyRequest {
  if (!value || typeof value !== 'object') return false
  return (value as Record<string, unknown>).type === SYLLABUS_PREVIEW_READY_REQUEST
}

export function urlsMatchForPreview(actualHref: string, expectedHref: string) {
  try {
    const actual = new URL(actualHref)
    const expected = new URL(expectedHref)
    return (
      actual.origin === expected.origin &&
      actual.pathname === expected.pathname &&
      actual.search === expected.search
    )
  } catch {
    return false
  }
}
