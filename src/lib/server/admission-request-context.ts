import { AsyncLocalStorage } from 'node:async_hooks'

// A store exists only for the lifetime of one API invocation. RSC consumers use
// React's request cache in the reader instead; background calls share no cache.
const requestReads = new AsyncLocalStorage<Map<string, Promise<unknown>>>()

export function withAdmissionRequestContext<T>(work: () => T): T {
  return requestReads.run(new Map(), work)
}

export function memoizeAdmissionRequestRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  const store = requestReads.getStore()
  if (!store) return read()
  const prior = store.get(key) as Promise<T> | undefined
  if (prior) return prior
  const result = read()
  store.set(key, result)
  return result
}
