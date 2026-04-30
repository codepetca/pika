import { vi } from 'vitest'

type QueryResult = {
  data?: any
  error?: any
}

export function makeQueryBuilder(result: QueryResult = {}) {
  const resolved = {
    data: result.data ?? null,
    error: result.error ?? null,
  }

  const builder: any = {
    select: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    upsert: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    neq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    single: vi.fn(async () => resolved),
    maybeSingle: vi.fn(async () => resolved),
    then: (onFulfilled: (value: QueryResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(resolved).then(onFulfilled, onRejected),
  }

  return builder
}

export function makeSupabaseFromQueues(queues: Record<string, any[]>) {
  return {
    from: vi.fn((table: string) => {
      const queue = queues[table]
      if (!queue || queue.length === 0) {
        throw new Error(`Unexpected Supabase table access: ${table}`)
      }

      return queue.shift()
    }),
  }
}
