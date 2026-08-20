import { describe, expect, it, vi } from 'vitest'

import { BaraAttendanceClientError } from '@/lib/server/bara-attendance-client'
import {
  BaraAttendanceOutboxError,
  deliverBaraAttendanceMessage,
  deliverBaraAttendanceOutboxBatch,
  getBaraAttendanceOutboxHealth,
  type AttendanceOutboxClient,
} from '@/lib/server/bara-attendance-outbox'
import type { V1SessionCommand } from '@/vendor/attendance-contract/v1/types'

const classroomId = '20000000-0000-4000-8000-000000000002'
const outboxId = '30000000-0000-4000-8000-000000000003'
const leaseToken = '40000000-0000-4000-8000-000000000004'
const message: V1SessionCommand = {
  schema_version: 1,
  message_type: 'session.command',
  idempotency_key: 'session:occurrence_private:request_one',
  correlation_ref: 'correlation_request_one',
  installation_ref: 'installation_staging',
  roster_ref: 'roster_private',
  occurrence_ref: 'occurrence_private',
  command: 'open',
  actor_principal_ref: 'principal_teacher',
  actor_display_name: 'Teacher One',
}
const result = {
  outcome: 'applied' as const,
  occurrenceRef: 'occurrence_private',
  status: 'open' as const,
  sessionRevision: 2,
}

function row(status: 'pending' | 'processing' | 'delivered' | 'non_retryable', input: {
  attempts?: number
  response?: unknown
} = {}) {
  return {
    id: outboxId,
    classroom_id: classroomId,
    idempotency_key: message.idempotency_key,
    message_type: message.message_type,
    payload: message,
    response_payload: input.response ?? null,
    status,
    attempts: input.attempts ?? 0,
    lease_token: status === 'processing' ? leaseToken : null,
  }
}

function rpcClient(
  implementation: (name: string, args?: Record<string, unknown>) => unknown,
) {
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => ({
    data: implementation(name, args),
    error: null,
  }))
  return { rpc } as unknown as AttendanceOutboxClient & { rpc: typeof rpc }
}

describe('Bara attendance outbound outbox', () => {
  it('preserves the Supabase client receiver when calling rpc', async () => {
    const supabase = {
      async rpc(this: unknown, name: string) {
        expect(this).toBe(supabase)
        expect(name).toBe('enqueue_attendance_outbound_message_v1')
        return { data: row('delivered', { response: result }), error: null }
      },
    } as unknown as AttendanceOutboxClient

    await expect(deliverBaraAttendanceMessage({
      supabase,
      classroomId,
      message,
      deliver: vi.fn(),
    })).resolves.toEqual(result)
  })

  it('persists and leases a command before signed delivery', async () => {
    const order: string[] = []
    const supabase = rpcClient((name) => {
      order.push(name)
      if (name === 'enqueue_attendance_outbound_message_v1') return row('pending')
      if (name === 'claim_attendance_outbound_message_v1') {
        return row('processing', { attempts: 1 })
      }
      if (name === 'complete_attendance_outbox_v1') return true
      throw new Error(`unexpected rpc ${name}`)
    })
    const deliver = vi.fn(async () => {
      order.push('network')
      return result
    })

    await expect(deliverBaraAttendanceMessage({
      supabase,
      classroomId,
      message,
      deliver,
    })).resolves.toEqual(result)
    expect(order).toEqual([
      'enqueue_attendance_outbound_message_v1',
      'claim_attendance_outbound_message_v1',
      'network',
      'complete_attendance_outbox_v1',
    ])
    expect(supabase.rpc).toHaveBeenNthCalledWith(1, 'enqueue_attendance_outbound_message_v1', {
      p_classroom_id: classroomId,
      p_message: message,
    })
    expect(supabase.rpc).toHaveBeenLastCalledWith('complete_attendance_outbox_v1', {
      p_outbox_id: outboxId,
      p_lease_token: leaseToken,
      p_response_payload: result,
    })
  })

  it('returns the stored provider-neutral result for an already delivered retry', async () => {
    const supabase = rpcClient((name) => {
      if (name === 'enqueue_attendance_outbound_message_v1') {
        return row('delivered', { response: result })
      }
      throw new Error(`unexpected rpc ${name}`)
    })
    const deliver = vi.fn()

    await expect(deliverBaraAttendanceMessage({
      supabase,
      classroomId,
      message,
      deliver,
    })).resolves.toEqual(result)
    expect(deliver).not.toHaveBeenCalled()
    expect(supabase.rpc).toHaveBeenCalledTimes(1)
  })

  it('records retryable failures without placing payload or remote details in error fields', async () => {
    const supabase = rpcClient((name, args) => {
      if (name === 'enqueue_attendance_outbound_message_v1') return row('pending')
      if (name === 'claim_attendance_outbound_message_v1') {
        return row('processing', { attempts: 1 })
      }
      if (name === 'retry_attendance_outbox_v1') {
        expect(args).toEqual({
          p_outbox_id: outboxId,
          p_lease_token: leaseToken,
          p_next_attempt_at: '2026-08-16T12:00:30.000Z',
          p_error_code: 'network_error',
          p_error_detail: 'Bara delivery failed (network_error)',
        })
        return true
      }
      throw new Error(`unexpected rpc ${name}`)
    })
    const remoteError = new BaraAttendanceClientError(
      'secret remote response',
      'network_error',
      true,
    )

    await expect(deliverBaraAttendanceMessage({
      supabase,
      classroomId,
      message,
      now: new Date('2026-08-16T12:00:00.000Z'),
      deliver: vi.fn().mockRejectedValue(remoteError),
    })).rejects.toBe(remoteError)
  })

  it('reuses the durable idempotency key after Bara is temporarily disabled', async () => {
    let attempt = 0
    const transitions: string[] = []
    const supabase = rpcClient((name) => {
      transitions.push(name)
      if (name === 'enqueue_attendance_outbound_message_v1') return row('pending', { attempts: attempt })
      if (name === 'claim_attendance_outbound_message_v1') {
        attempt += 1
        return row('processing', { attempts: attempt })
      }
      if (name === 'retry_attendance_outbox_v1') return true
      if (name === 'complete_attendance_outbox_v1') return true
      throw new Error(`unexpected rpc ${name}`)
    })
    const disabledError = new BaraAttendanceClientError(
      'Bara attendance integration is temporarily unavailable',
      'not_found',
      true,
      404,
    )
    const deliver = vi.fn()
      .mockRejectedValueOnce(disabledError)
      .mockResolvedValueOnce(result)

    await expect(deliverBaraAttendanceMessage({
      supabase,
      classroomId,
      message,
      deliver,
    })).rejects.toBe(disabledError)
    await expect(deliverBaraAttendanceMessage({
      supabase,
      classroomId,
      message,
      deliver,
    })).resolves.toEqual(result)

    expect(deliver).toHaveBeenCalledTimes(2)
    expect(deliver.mock.calls.map(([deliveredMessage]) => deliveredMessage.idempotency_key))
      .toEqual([message.idempotency_key, message.idempotency_key])
    expect(transitions).toEqual([
      'enqueue_attendance_outbound_message_v1',
      'claim_attendance_outbound_message_v1',
      'retry_attendance_outbox_v1',
      'enqueue_attendance_outbound_message_v1',
      'claim_attendance_outbound_message_v1',
      'complete_attendance_outbox_v1',
    ])
  })

  it('fails closed when the same idempotency key is reused with different content', async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: '23505', message: 'database detail' },
      }),
    }

    await expect(deliverBaraAttendanceMessage({
      supabase,
      classroomId,
      message,
      deliver: vi.fn(),
    })).rejects.toMatchObject<BaraAttendanceOutboxError>({
      code: 'idempotency_conflict',
      retryable: false,
    })
  })

  it('drains claimed rows and classifies retryable failures', async () => {
    const supabase = rpcClient((name) => {
      if (name === 'claim_attendance_outbox_batch_v1') {
        return [row('processing', { attempts: 2 })]
      }
      if (name === 'retry_attendance_outbox_v1') return true
      throw new Error(`unexpected rpc ${name}`)
    })

    await expect(deliverBaraAttendanceOutboxBatch({
      supabase,
      enabled: true,
      now: new Date('2026-08-16T12:00:00.000Z'),
      deliver: vi.fn().mockRejectedValue(new BaraAttendanceClientError(
        'unavailable',
        'network_error',
        true,
      )),
    })).resolves.toEqual({
      status: 'partial',
      claimed: 1,
      delivered: 0,
      retrying: 1,
      nonRetryable: 0,
    })
  })

  it('returns aggregate-only delivery health and degrades while any work remains', async () => {
    const supabase = rpcClient((name) => {
      if (name === 'attendance_outbox_health_v1') {
        return {
          pending: 2,
          processing: 1,
          non_retryable: 1,
          due: 2,
          oldest_unresolved_at: '2026-08-16T12:00:00+00:00',
        }
      }
      throw new Error(`unexpected rpc ${name}`)
    })

    const health = await getBaraAttendanceOutboxHealth({ supabase, enabled: true })

    expect(health).toEqual({
      status: 'degraded',
      pending: 2,
      processing: 1,
      nonRetryable: 1,
      due: 2,
      oldestUnresolvedAt: '2026-08-16T12:00:00+00:00',
    })
    expect(JSON.stringify(health)).not.toContain('classroom')
    expect(JSON.stringify(health)).not.toContain('student')
  })

  it('does not read the outbox while disabled and reports a clean empty outbox', async () => {
    const supabase = rpcClient(() => ({
      pending: 0,
      processing: 0,
      non_retryable: 0,
      due: 0,
      oldest_unresolved_at: null,
    }))

    await expect(getBaraAttendanceOutboxHealth({
      supabase,
      enabled: false,
    })).resolves.toEqual({
      status: 'disabled',
      pending: 0,
      processing: 0,
      nonRetryable: 0,
      due: 0,
      oldestUnresolvedAt: null,
    })
    expect(supabase.rpc).not.toHaveBeenCalled()

    await expect(getBaraAttendanceOutboxHealth({
      supabase,
      enabled: true,
    })).resolves.toMatchObject({ status: 'ok', oldestUnresolvedAt: null })
  })
})
