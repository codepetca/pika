import { describe, expect, it, vi } from 'vitest'
import { projectAssignmentReleaseStates } from '@/lib/server/billing/assignment-release-state'

const draft = (id: string) => ({ id, is_draft: true, released_at: null, updated_at: '2026-11-08T10:00:00.123456Z' })
const schedule = { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', scheduled_for: '2026-11-09T10:00:00Z', state: 'pending', notice_code: null }
const row = (id: string, overrides = {}) => ({ assignment_id: id, updated_at: '2026-11-08T05:00:00.123456-05:00', release_schedule: { ...schedule }, ...overrides })

describe('owner assignment release projection', () => {
  it('batches drafts and matches timestamp instants at Postgres precision', async () => {
    const rpc = vi.fn((_name, args) => ({ abortSignal: vi.fn().mockResolvedValue({ data: args.p_assignment_ids.map((id: string) => row(id)), error: null }) }))
    const input = Array.from({ length: 101 }, (_, i) => draft(String(i)))
    const projected = await projectAssignmentReleaseStates({ rpc }, 'owner', 'class', input)
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls[0][1].p_assignment_ids).toHaveLength(100)
    expect(projected[0]).toEqual({ ...input[0], release_schedule: schedule })
    expect(projected[100].released_at).toBeNull()
  })
  it('omits stale state and makes no call for published assignments', async () => {
    const rpc = vi.fn(() => ({ abortSignal: vi.fn().mockResolvedValue({ data: [row('draft', { updated_at: '2026-11-08T10:00:00.123457Z' })], error: null }) }))
    const input = [draft('draft'), { ...draft('live'), is_draft: false }]
    expect(await projectAssignmentReleaseStates({ rpc }, 'owner', 'class', input)).toEqual(input)
    expect(rpc.mock.calls[0][1].p_assignment_ids).toEqual(['draft'])
    rpc.mockClear()
    await projectAssignmentReleaseStates({ rpc }, 'owner', 'class', [input[1]])
    expect(rpc).not.toHaveBeenCalled()
  })
  it('allows only missing RPC compatibility and fails closed on errors or invalid rows', async () => {
    const input = [draft('draft')]
    const abortSignal = vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202' } })
    const rpc = vi.fn(() => ({ abortSignal }))
    expect(await projectAssignmentReleaseStates({ rpc }, 'owner', 'class', input)).toEqual(input)
    for (const response of [
      { data: null, error: { code: 'other' } },
      { data: null, error: null },
      { data: [row('other')], error: null },
      { data: [row('draft'), row('draft')], error: null },
      { data: Array.from({ length: 101 }, () => row('draft')), error: null },
      { data: [row('draft', { release_schedule: { ...schedule, notice_code: 'access_unavailable' } })], error: null },
    ]) {
      abortSignal.mockResolvedValueOnce(response)
      await expect(projectAssignmentReleaseStates({ rpc }, 'owner', 'class', input)).rejects.toMatchObject({ statusCode: 503 })
    }
  })
  it('aborts a stalled legacy projection and caps request volume', async () => {
    vi.useFakeTimers()
    try {
      let signal: AbortSignal | undefined
      const rpc = vi.fn(() => ({ abortSignal: (value: AbortSignal) => { signal = value; return new Promise<never>(() => {}) } }))
      const pending = projectAssignmentReleaseStates({ rpc }, 'owner', 'class', [draft('draft')])
      const rejected = expect(pending).rejects.toMatchObject({ statusCode: 503 })
      await vi.advanceTimersByTimeAsync(20_000)
      await rejected
      expect(signal?.aborted).toBe(true)
      rpc.mockClear()
      await expect(projectAssignmentReleaseStates({ rpc }, 'owner', 'class', Array.from({ length: 10001 }, (_, i) => draft(String(i))))).rejects.toMatchObject({ statusCode: 503 })
      expect(rpc).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

})
