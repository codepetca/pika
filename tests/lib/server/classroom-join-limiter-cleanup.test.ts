import { describe, expect, it, vi } from 'vitest'
import type { getServiceRoleClient } from '@/lib/supabase'
import { cleanupClassroomJoinLimiter } from '@/lib/server/classroom-join-limiter-cleanup'

function client(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as unknown as ReturnType<typeof getServiceRoleClient>
}

describe('classroom join limiter maintenance', () => {
  it.each([0, 12, 9_999])('accepts a bounded cleanup of %i expired records', async (data) => {
    const rpc = vi.fn().mockResolvedValue({ data, error: null })
    await expect(cleanupClassroomJoinLimiter(client(rpc))).resolves.toBe(true)
    expect(rpc).toHaveBeenCalledExactlyOnceWith('cleanup_classroom_join_rate_limits_v1', {
      p_batch_size: 10_000,
    })
  })

  it.each([null, '0', -1, 0.5, 10_001, 10_000])('fails health for invalid or exhausted capacity: %s', async (data) => {
    const rpc = vi.fn().mockResolvedValue({ data, error: null })
    await expect(cleanupClassroomJoinLimiter(client(rpc))).resolves.toBe(false)
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('fails closed on database errors without logging raw details', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const rpc = vi.fn().mockResolvedValue({ data: 0, error: { message: 'sensitive details' } })
    await expect(cleanupClassroomJoinLimiter(client(rpc))).resolves.toBe(false)
    expect(log).toHaveBeenCalledWith('[classroom-join-limiter-cleanup] failed')
    expect(JSON.stringify(log.mock.calls)).not.toContain('sensitive details')
    log.mockRestore()
  })

  it('reports transport failure without an unbounded retry', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('transport failure'))
    await expect(cleanupClassroomJoinLimiter(client(rpc))).resolves.toBe(false)
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})
