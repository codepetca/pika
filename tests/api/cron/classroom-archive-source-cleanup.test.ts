import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getServiceRoleClient: vi.fn(),
  isTriggerEnabled: vi.fn(),
  resolveLeaseToken: vi.fn(),
  runCleanup: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: mocks.getServiceRoleClient,
}))

vi.mock('@/lib/server/classroom-archive-source-cleanup', () => ({
  CLASSROOM_ARCHIVE_SOURCE_CLEANUP_DEFAULT_LEASE_SECONDS: 300,
  isClassroomArchiveSourceCleanupTriggerEnabled: mocks.isTriggerEnabled,
  resolveClassroomArchiveSourceCleanupLeaseToken: mocks.resolveLeaseToken,
  runClassroomArchiveSourceCleanup: mocks.runCleanup,
}))

import { GET, POST } from '@/app/api/cron/classroom-archive-source-cleanup/route'

const LEASE_TOKEN = '10000000-0000-4000-8000-000000000001'
const OBJECT_REF = 'a'.repeat(64)
const supabase = { client: true }

function request(method: 'GET' | 'POST' = 'GET', token = 'secret') {
  return new NextRequest('http://localhost:3000/api/cron/classroom-archive-source-cleanup', {
    method,
    headers: { authorization: `Bearer ${token}` },
  })
}

function successfulResult(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    lease_token: LEASE_TOKEN,
    claimed: 0,
    deleted: 0,
    failed: 0,
    retry_recording_failed: 0,
    results: [],
    ...overrides,
  }
}

describe('classroom archive source cleanup cron route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv('CRON_SECRET', 'secret')
    mocks.getServiceRoleClient.mockReturnValue(supabase)
    mocks.isTriggerEnabled.mockReturnValue(true)
    mocks.resolveLeaseToken.mockReturnValue(LEASE_TOKEN)
    mocks.runCleanup.mockResolvedValue(successfulResult())
  })

  it('fails closed before resolving a lease when CRON_SECRET is missing', async () => {
    vi.stubEnv('CRON_SECRET', '')

    const response = await GET(request())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'CRON_SECRET not configured' })
    expect(mocks.isTriggerEnabled).not.toHaveBeenCalled()
    expect(mocks.resolveLeaseToken).not.toHaveBeenCalled()
    expect(mocks.getServiceRoleClient).not.toHaveBeenCalled()
    expect(mocks.runCleanup).not.toHaveBeenCalled()
  })

  it('rejects invalid or missing bearer authorization before checking either gate', async () => {
    for (const invalidRequest of [
      request('GET', 'wrong'),
      new NextRequest('http://localhost:3000/api/cron/classroom-archive-source-cleanup'),
    ]) {
      const response = await GET(invalidRequest)

      expect(response.status).toBe(401)
      await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    }
    expect(mocks.isTriggerEnabled).not.toHaveBeenCalled()
    expect(mocks.resolveLeaseToken).not.toHaveBeenCalled()
    expect(mocks.getServiceRoleClient).not.toHaveBeenCalled()
    expect(mocks.runCleanup).not.toHaveBeenCalled()
  })

  it('fails closed behind the independent trigger gate without creating a client', async () => {
    mocks.isTriggerEnabled.mockReturnValue(false)

    const response = await GET(request())

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      status: 503,
      lease_token: LEASE_TOKEN,
      error_code: 'classroom_archive_source_cleanup_trigger_not_enabled',
      error: 'Classroom archive source cleanup trigger is not enabled',
      retryable: true,
    })
    expect(mocks.resolveLeaseToken).toHaveBeenCalledOnce()
    expect(mocks.getServiceRoleClient).not.toHaveBeenCalled()
    expect(mocks.runCleanup).not.toHaveBeenCalled()
  })

  it.each(['GET', 'POST'] as const)(
    'runs a one-claim cleanup canary through %s',
    async (method) => {
      const response = method === 'GET'
        ? await GET(request(method))
        : await POST(request(method))

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual(successfulResult())
      expect(mocks.runCleanup).toHaveBeenCalledWith({
        supabase,
        leaseToken: LEASE_TOKEN,
        limit: 1,
        leaseSeconds: 300,
      })
    },
  )

  it('propagates a disabled worker result and status', async () => {
    const result = {
      ok: false,
      status: 503,
      lease_token: LEASE_TOKEN,
      error_code: 'classroom_archive_source_cleanup_not_enabled',
      error: 'Classroom archive source cleanup is not enabled',
      retryable: true,
    }
    mocks.runCleanup.mockResolvedValue(result)

    const response = await GET(request())

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual(result)
  })

  it('reports a durably recorded item retry as a healthy invocation', async () => {
    const result = successfulResult({
      claimed: 1,
      failed: 1,
      results: [{
        object_ref: OBJECT_REF,
        attempt_count: 1,
        status: 'failed',
        error_code: 'archive_source_object_read_failed',
        retry_recorded: true,
      }],
    })
    mocks.runCleanup.mockResolvedValue(result)

    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(result)
  })

  it('returns 503 when any claim lacks durable retry evidence', async () => {
    const batch = successfulResult({
      claimed: 1,
      failed: 1,
      retry_recording_failed: 1,
      results: [{
        object_ref: OBJECT_REF,
        attempt_count: 1,
        status: 'failed',
        error_code: 'archive_source_cleanup_completion_rejected',
        retry_recorded: false,
      }],
    })
    mocks.runCleanup.mockResolvedValue(batch)

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body).toEqual({
      ok: false,
      status: 503,
      error_code: 'archive_source_cleanup_batch_unhealthy',
      error: 'Classroom archive source cleanup completed without durable evidence for every claim',
      retryable: true,
      batch,
    })
    expect(JSON.stringify(body)).not.toContain('storage_path')
    expect(JSON.stringify(body)).not.toContain('expected_sha256')
  })

  it('is not registered for automatic invocation in Vercel', () => {
    const config = JSON.parse(readFileSync('vercel.json', 'utf8'))
    const environmentExample = readFileSync('.env.example', 'utf8')

    expect(config.crons).not.toContainEqual(expect.objectContaining({
      path: '/api/cron/classroom-archive-source-cleanup',
    }))
    expect(environmentExample).toContain('CLASSROOM_ARCHIVE_SOURCE_CLEANUP_ENABLED=false')
    expect(environmentExample).toContain(
      'CLASSROOM_ARCHIVE_SOURCE_CLEANUP_TRIGGER_ENABLED=false',
    )
  })
})
