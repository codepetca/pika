export type CourseBlueprintImportOperation = {
  id: string
  contentType: 'application/json' | 'application/x-tar'
  body: string | ArrayBuffer
}

function importBodiesMatch(
  previous: CourseBlueprintImportOperation['body'],
  next: CourseBlueprintImportOperation['body'],
) {
  if (typeof previous === 'string' || typeof next === 'string') return previous === next

  const previousBytes = new Uint8Array(previous)
  const nextBytes = new Uint8Array(next)
  if (previousBytes.byteLength !== nextBytes.byteLength) return false
  return previousBytes.every((byte, index) => byte === nextBytes[index])
}

export async function resolveCourseBlueprintImportOperation(
  file: File,
  previous: CourseBlueprintImportOperation | null,
): Promise<CourseBlueprintImportOperation> {
  const isJsonBundle = file.name.toLowerCase().endsWith('.json')
  const contentType = isJsonBundle ? 'application/json' : 'application/x-tar'
  const body = isJsonBundle
    ? JSON.stringify(JSON.parse(await file.text()))
    : await file.arrayBuffer()

  if (
    previous
    && previous.contentType === contentType
    && importBodiesMatch(previous.body, body)
  ) {
    return previous
  }

  return { id: crypto.randomUUID(), contentType, body }
}

export function courseBlueprintImportRequestInit(
  operation: CourseBlueprintImportOperation,
): RequestInit {
  return {
    method: 'POST',
    headers: {
      'Content-Type': operation.contentType,
      'Idempotency-Key': operation.id,
    },
    body: operation.body,
  }
}
