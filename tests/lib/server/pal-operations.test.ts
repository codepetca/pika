import { describe, expect, it, vi } from 'vitest'

import { loadPalOutboxStatus } from '@/lib/server/pal-operations'

type QueryResult = {
  data?: unknown
  count?: number | null
  error: { message: string } | null
}

function query(result: QueryResult) {
  const builder: Record<string, any> = {}
  for (const method of ['select', 'eq', 'gt', 'lte', 'gte', 'not', 'in', 'order', 'limit']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.maybeSingle = vi.fn(async () => result)
  builder.then = (
    resolve: (value: QueryResult) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject)
  return builder
}

describe('Pal outbox operations observability', () => {
  it('reports backlog, retries, expired leases, and recent delivery latency without payloads', async () => {
    const results: QueryResult[] = [
      { count: 4, error: null },
      { count: 2, error: null },
      { count: 12, error: null },
      { count: 1, error: null },
      {
        data: [{
          id: '10000000-0000-4000-8000-000000000001',
          event_type: 'daily_log.completed',
          status: 'pending',
          attempts: 2,
          next_attempt_at: '2026-08-08T15:59:00.000Z',
          last_attempt_at: '2026-08-08T15:58:00.000Z',
          last_error_code: 'network_error',
          last_error_detail: 'Pal delivery failed before an HTTP response was received',
          created_at: '2026-08-08T15:50:00.000Z',
          updated_at: '2026-08-08T15:58:00.000Z',
        }],
        error: null,
      },
      { count: 3, error: null },
      { count: 1, error: null },
      { data: { created_at: '2026-08-08T15:50:00.000Z' }, error: null },
      { data: { created_at: '2026-08-08T15:55:00.000Z' }, error: null },
      {
        data: [
          {
            created_at: '2026-08-08T15:00:00.000Z',
            delivered_at: '2026-08-08T15:00:00.100Z',
          },
          {
            created_at: '2026-08-08T15:01:00.000Z',
            delivered_at: '2026-08-08T15:01:00.500Z',
          },
          {
            created_at: '2026-08-08T15:02:00.000Z',
            delivered_at: '2026-08-08T15:02:02.000Z',
          },
        ],
        error: null,
      },
    ]
    const builders = results.map(query)
    const from = vi.fn(() => builders.shift())
    const rpc = vi.fn(async () => ({ data: 2, error: null }))

    await expect(loadPalOutboxStatus({
      supabase: { from, rpc } as any,
      now: new Date('2026-08-08T16:00:00.000Z'),
    })).resolves.toEqual({
      enabled: false,
      counts: {
        pending: 4,
        processing: 2,
        delivered: 12,
        non_retryable: 1,
      },
      observability: {
        ready: 2,
        retrying: 3,
        expired_leases: 1,
        oldest_ready_at: '2026-08-08T15:50:00.000Z',
        oldest_ready_age_seconds: 600,
        delivery_latency_24h: {
          sample_size: 3,
          p50_ms: 500,
          p95_ms: 2_000,
          max_ms: 2_000,
        },
      },
      exceptions: expect.any(Array),
    })

    const serialized = JSON.stringify(await loadPalOutboxStatus({
      supabase: {
        from: vi.fn(() => query({ data: [], count: 0, error: null })),
        rpc: vi.fn(async () => ({ data: 0, error: null })),
      } as any,
      now: new Date('2026-08-08T16:00:00.000Z'),
    }))
    expect(serialized).not.toContain('payload')
    expect(serialized).not.toContain('student_id')
    expect(serialized).not.toContain('source_id')
  })
})
