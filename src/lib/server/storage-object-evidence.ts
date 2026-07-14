export type StorageErrorShape = {
  name?: unknown
  status?: unknown
  statusCode?: unknown
  code?: unknown
  error?: unknown
  originalError?: unknown
}

export function missingStorageObjectEvidence(
  error: unknown,
  inspectNested = true,
): 'object' | 'generic' | null {
  if (!error || typeof error !== 'object') return null
  const value = error as StorageErrorShape
  const codes = [value.statusCode, value.code, value.error]
    .filter((code): code is string | number => (
      typeof code === 'string' || typeof code === 'number'
    ))
    .map((code) => String(code).toLowerCase())
  if (codes.includes('nosuchbucket')) return null
  if (codes.includes('nosuchkey')) return 'object'
  const status = [value.status, value.statusCode]
    .map((candidate) => typeof candidate === 'number' ? candidate : Number(candidate))
    .find((candidate) => Number.isFinite(candidate))
  if (status === 404 && (
    codes.length === 0 || codes.includes('404') || codes.includes('not_found')
  )) {
    return 'generic'
  }
  if (
    inspectNested
    && value.name === 'StorageUnknownError'
    && value.originalError
    && typeof value.originalError === 'object'
  ) {
    const originalError = value.originalError as StorageErrorShape
    const originalStatus = typeof originalError.status === 'number'
      ? originalError.status
      : Number(originalError.status)
    if (originalStatus === 404) return 'generic'
  }
  if (inspectNested && value.originalError !== error) {
    return missingStorageObjectEvidence(value.originalError, false)
  }
  return null
}
