import { describe, expect, it, vi } from 'vitest'
import {
  beginCleanupHistoryCronRun,
  CronRunLedgerError,
  finishCleanupHistoryCronRun,
  readCleanupHistoryCronHealth,
  resolveCleanupHistoryInvocation,
} from '@/lib/server/cron-run-ledger'

function rpcClient(results: Array<{ data: unknown; error: unknown }>) {
  return {
    rpc: vi.fn(async () => results.shift() ?? { data: null, error: null }),
  }
}

describe('cleanup-history cron run ledger', () => {
  it('distinguishes a Vercel scheduled invocation from a manual invocation', () => {
    expect(resolveCleanupHistoryInvocation(new Headers({
      'x-vercel-cron-schedule': '0 7 * * *',
    }), 'deployment-1')).toEqual({
      invocationSource: 'vercel_cron',
      schedule: '0 7 * * *',
      deploymentId: 'deployment-1',
    })
    expect(resolveCleanupHistoryInvocation(new Headers(), undefined)).toEqual({
      invocationSource: 'manual',
      schedule: null,
      deploymentId: null,
    })
  })

  it('starts a durable run through the service-only RPC', async () => {
    const supabase = rpcClient([{
      data: {
        run_id: '00000000-0000-4000-8000-000000000111',
        started: true,
      },
      error: null,
    }])

    await expect(beginCleanupHistoryCronRun({
      supabase: supabase as never,
      invocation: {
        invocationSource: 'vercel_cron',
        schedule: '0 7 * * *',
        deploymentId: 'deployment-1',
      },
    })).resolves.toEqual({
      schemaAvailable: true,
      runId: '00000000-0000-4000-8000-000000000111',
      started: true,
    })
    expect(supabase.rpc).toHaveBeenCalledWith('begin_cleanup_history_cron_run', {
      p_invocation_source: 'vercel_cron',
      p_schedule: '0 7 * * *',
      p_deployment_id: 'deployment-1',
    })
  })

  it('treats only the missing pre-124 RPC as a compatibility state', async () => {
    const missing = rpcClient([{
      data: null,
      error: { code: 'PGRST202', message: 'missing' },
    }])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(beginCleanupHistoryCronRun({
      supabase: missing as never,
      invocation: {
        invocationSource: 'manual',
        schedule: null,
        deploymentId: null,
      },
    })).resolves.toEqual({ schemaAvailable: false })
    expect(warn).toHaveBeenCalledWith('[cron-run-ledger] schema unavailable', {
      error_code: 'PGRST202',
    })

    const broken = rpcClient([{
      data: null,
      error: { code: '42P01', message: 'provider detail' },
    }])
    await expect(beginCleanupHistoryCronRun({
      supabase: broken as never,
      invocation: {
        invocationSource: 'manual',
        schedule: null,
        deploymentId: null,
      },
    })).rejects.toMatchObject({
      code: 'cron_run_begin_failed',
      message: 'Cron run ledger could not be updated',
    })
  })

  it('rejects malformed begin responses', async () => {
    const supabase = rpcClient([{ data: { run_id: 'not-a-uuid' }, error: null }])

    await expect(beginCleanupHistoryCronRun({
      supabase: supabase as never,
      invocation: {
        invocationSource: 'manual',
        schedule: null,
        deploymentId: null,
      },
    })).rejects.toBeInstanceOf(CronRunLedgerError)
  })

  it('records a privacy-safe, allowlisted completion summary', async () => {
    const supabase = rpcClient([{ data: true, error: null }])

    await expect(finishCleanupHistoryCronRun({
      supabase: supabase as never,
      run: {
        schemaAvailable: true,
        runId: '00000000-0000-4000-8000-000000000111',
        started: true,
      },
      status: 'succeeded',
      httpStatus: 200,
      errorCode: null,
      metrics: {
        history_rows_deleted: 3,
        student_purge_processed: 1,
        student_health_stuck: 0,
        managed_health_healthy: true,
      },
    })).resolves.toBeUndefined()
    expect(supabase.rpc).toHaveBeenCalledWith('finish_cleanup_history_cron_run', {
      p_run_id: '00000000-0000-4000-8000-000000000111',
      p_status: 'succeeded',
      p_http_status: 200,
      p_error_code: null,
      p_metrics: {
        history_rows_deleted: 3,
        student_purge_processed: 1,
        student_health_stuck: 0,
        managed_health_healthy: true,
      },
    })
  })

  it('does not call finish before migration 124 or for an overlap row', async () => {
    const supabase = rpcClient([])

    await finishCleanupHistoryCronRun({
      supabase: supabase as never,
      run: { schemaAvailable: false },
      status: 'succeeded',
      httpStatus: 200,
      errorCode: null,
      metrics: {},
    })
    await finishCleanupHistoryCronRun({
      supabase: supabase as never,
      run: {
        schemaAvailable: true,
        runId: '00000000-0000-4000-8000-000000000222',
        started: false,
      },
      status: 'failed',
      httpStatus: 409,
      errorCode: 'overlap',
      metrics: {},
    })

    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('rejects identities and unknown keys before persistence', async () => {
    const supabase = rpcClient([])

    await expect(finishCleanupHistoryCronRun({
      supabase: supabase as never,
      run: {
        schemaAvailable: true,
        runId: '00000000-0000-4000-8000-000000000111',
        started: true,
      },
      status: 'failed',
      httpStatus: 500,
      errorCode: 'unhandled_error',
      metrics: { student_id: 'sensitive' } as never,
    })).rejects.toMatchObject({ code: 'cron_run_metrics_invalid' })
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('sanitizes finish failures', async () => {
    const supabase = rpcClient([{
      data: null,
      error: { code: 'provider-code', message: 'provider detail' },
    }])

    await expect(finishCleanupHistoryCronRun({
      supabase: supabase as never,
      run: {
        schemaAvailable: true,
        runId: '00000000-0000-4000-8000-000000000111',
        started: true,
      },
      status: 'failed',
      httpStatus: 500,
      errorCode: 'unhandled_error',
      metrics: {},
    })).rejects.toMatchObject({
      code: 'cron_run_finish_failed',
      message: 'Cron run ledger could not be updated',
    })
  })

  it('reads and validates the privacy-safe operator health snapshot', async () => {
    const supabase = rpcClient([{
      data: {
        version: 1,
        captured_at: '2026-08-14T12:00:00.000Z',
        healthy: true,
        stale_running_count: 0,
        failed_count_7d: 0,
        overlap_count_7d: 0,
        latest_run: {
          invocation_source: 'vercel_cron',
          schedule: '0 7 * * *',
          status: 'succeeded',
          started_at: '2026-08-14T07:12:00.000Z',
          completed_at: '2026-08-14T07:12:03.000Z',
          http_status: 200,
          error_code: null,
          metrics: { managed_health_healthy: true },
        },
        latest_vercel_run: {
          schedule: '0 7 * * *',
          status: 'succeeded',
          started_at: '2026-08-14T07:12:00.000Z',
          completed_at: '2026-08-14T07:12:03.000Z',
          http_status: 200,
          error_code: null,
          metrics: { managed_health_healthy: true },
        },
      },
      error: null,
    }])

    await expect(readCleanupHistoryCronHealth({
      supabase: supabase as never,
    })).resolves.toMatchObject({
      schemaAvailable: true,
      snapshot: {
        healthy: true,
        latest_vercel_run: { status: 'succeeded', http_status: 200 },
      },
    })
    expect(supabase.rpc).toHaveBeenCalledWith(
      'get_cleanup_history_cron_health_snapshot',
      { p_stale_minutes: 120 },
    )
  })

  it('fails closed for malformed cron health and invalid thresholds', async () => {
    const malformed = rpcClient([{ data: { healthy: true }, error: null }])
    await expect(readCleanupHistoryCronHealth({
      supabase: malformed as never,
    })).rejects.toMatchObject({ code: 'cron_run_health_contract_invalid' })
    await expect(readCleanupHistoryCronHealth({
      supabase: malformed as never,
      staleMinutes: 4,
    })).rejects.toMatchObject({ code: 'cron_run_health_threshold_invalid' })
  })
})
