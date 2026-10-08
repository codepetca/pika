// Only callers started in the same synchronous batch share a lookup. A caller
// after any awaited/browser event boundary must observe the current session,
// even if an earlier request is still in flight. Never retain a settled identity.
let batchIdentity: Promise<string | null> | null = null

async function fetchCurrentUserId(): Promise<string | null> {
  const response = await fetch('/api/auth/me', { cache: 'no-store' })
  const data = await response.json().catch(() => null) as { user?: { id?: unknown } } | null
  if (!response.ok || typeof data?.user?.id !== 'string') return null
  return data.user.id
}

export function getCurrentUserId(): Promise<string | null> {
  if (batchIdentity) return batchIdentity

  const identity = fetchCurrentUserId()
  batchIdentity = identity
  queueMicrotask(() => {
    if (batchIdentity === identity) batchIdentity = null
  })
  return identity
}
