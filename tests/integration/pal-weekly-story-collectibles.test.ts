import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { deliverPalOutboxBatch } from '@/lib/server/pal-outbox'
import { syncPalWeeklyConfigurations } from '@/lib/server/pal-weekly-config'
import { v1 } from '@/vendor/pal-contract'

const studentId = '10000000-0000-4000-8000-000000000001'
const rowId = '20000000-0000-4000-8000-000000000001'
const leaseToken = '30000000-0000-4000-8000-000000000001'

function queryResult(data: unknown[]) {
  const query: any = {}
  for (const method of [
    'select',
    'eq',
    'lt',
    'order',
    'limit',
    'contains',
    'in',
    'gte',
    'lte',
    'range',
  ]) {
    query[method] = vi.fn(() => query)
  }
  query.then = (
    resolve: (value: { data: unknown[]; error: null }) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve({ data, error: null }).then(resolve, reject)
  return query
}

describe('Pika to Pal weekly story calendar vertical slice', () => {
  beforeEach(() => {
    vi.stubEnv('PAL_ENABLED', 'true')
    vi.stubEnv('PAL_API_URL', 'https://pal.example.test')
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'pal-integration-secret-32-characters')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'test-pseudonym-secret-32-characters-long')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('atomically records, validates, and delivers a prospective calendar fact', async () => {
    const tableResults: Record<string, unknown[][]> = {
      pal_daily_log_week_configurations: [[], []],
      classroom_enrollments: [[{
        id: '40000000-0000-4000-8000-000000000001',
        student_id: studentId,
        classroom_id: '50000000-0000-4000-8000-000000000001',
        created_at: '2026-09-01T12:00:00.000Z',
        classrooms: {
          start_date: '2026-09-01',
          end_date: '2027-01-31',
          archived_at: null,
        },
      }]],
      pal_event_outbox: [[]],
      class_days: [[
        { id: 'day-1', classroom_id: '50000000-0000-4000-8000-000000000001', date: '2026-09-14', is_class_day: true },
        { id: 'day-2', classroom_id: '50000000-0000-4000-8000-000000000001', date: '2026-09-16', is_class_day: true },
        { id: 'day-3', classroom_id: '50000000-0000-4000-8000-000000000001', date: '2026-09-18', is_class_day: true },
      ]],
    }
    let recordedEvent: v1.V1Envelope | null = null
    const transitions: string[] = []
    const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
      if (name === 'record_pal_daily_log_week_configuration_atomic') {
        recordedEvent = args?.p_pal_event as v1.V1Envelope
        return { data: true, error: null }
      }
      if (name === 'claim_pal_event_outbox') {
        return {
          data: [{
            id: rowId,
            payload: recordedEvent,
            attempts: 1,
            lease_token: leaseToken,
          }],
          error: null,
        }
      }
      transitions.push(name)
      return { data: true, error: null }
    })
    const supabase = {
      from: vi.fn((table: string) => queryResult(tableResults[table]?.shift() ?? [])),
      rpc,
    }
    const now = new Date('2026-09-14T15:00:00.000Z')

    await expect(syncPalWeeklyConfigurations({
      supabase: supabase as any,
      now,
    })).resolves.toEqual({
      status: 'ok',
      configured: 1,
      closed: 0,
      catchUpPeriods: 0,
      remainingCatchUp: false,
    })

    expect(rpc).toHaveBeenCalledWith(
      'record_pal_daily_log_week_configuration_atomic',
      expect.objectContaining({ p_student_id: studentId }),
    )
    expect(recordedEvent).not.toBeNull()
    expect(v1.validateV1Event(recordedEvent)).toMatchObject({ ok: true })
    expect(recordedEvent?.metadata).toEqual({
      period_key: 'pika-week-2026-09-14',
      config_version: 1,
      period_status: 'open',
      eligible_days: 3,
      term_token: expect.stringMatching(/^pika-term-/),
      term_start_day: '2026-08-31',
      term_end_day: '2027-01-31',
      term_timezone: 'America/Toronto',
      term_week_count: 22,
      week_start_day: '2026-09-14',
      week_index: 3,
    })
    for (const forbiddenKey of ['collectible', 'finish', 'xp', 'achievement']) {
      expect(Object.keys(recordedEvent?.metadata ?? {})).not.toContain(forbiddenKey)
    }

    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }))
    await expect(deliverPalOutboxBatch({
      supabase,
      fetchImpl,
      now,
    })).resolves.toMatchObject({ delivered: 1, retrying: 0, nonRetryable: 0 })
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual(recordedEvent)
    expect(transitions).toContain('complete_pal_event_outbox')
  })
})
