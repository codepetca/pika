import { describe, expect, it, vi } from 'vitest'
import {
  AttendanceScanLoadConfigurationError,
  nearestRankPercentile,
  parseAttendanceScanLoadManifest,
  runAttendanceScanLoad,
  validateAttendanceScanLoadTarget,
} from '@/lib/server/bara-attendance-load'

const entryToken = 'a'.repeat(80)

function loadCases(count = 30) {
  return Array.from({ length: count }, (_, index) => ({
    cookie: `pika_session=pika-${index}; pika-wos-session=workos-${index}`,
    entryToken,
  }))
}

describe('Bara attendance scan load measurement', () => {
  it('requires distinct sessions and between 30 and 100 cases', () => {
    expect(parseAttendanceScanLoadManifest({ cases: loadCases(30) }).cases).toHaveLength(30)
    expect(() => parseAttendanceScanLoadManifest({ cases: loadCases(29) }))
      .toThrow(AttendanceScanLoadConfigurationError)
    const duplicatePikaSession = loadCases(30)
    duplicatePikaSession[1].cookie = 'pika_session=pika-0; pika-wos-session=workos-1; padding=unique'
    expect(() => parseAttendanceScanLoadManifest({ cases: duplicatePikaSession }))
      .toThrow(AttendanceScanLoadConfigurationError)
    const duplicateWorkosSession = loadCases(30)
    duplicateWorkosSession[1].cookie = 'pika_session=pika-1; pika-wos-session=workos-0; padding=unique'
    expect(() => parseAttendanceScanLoadManifest({ cases: duplicateWorkosSession }))
      .toThrow(AttendanceScanLoadConfigurationError)
  })

  it('refuses production, non-HTTPS targets, origin drift, and count drift', () => {
    const valid = {
      stage: 'preview',
      baseUrl: 'https://pika-preview.example.test',
      expectedOrigin: 'https://pika-preview.example.test/',
      concurrency: 30,
      caseCount: 30,
    }
    expect(validateAttendanceScanLoadTarget(valid)).toBe('https://pika-preview.example.test')
    expect(() => validateAttendanceScanLoadTarget({ ...valid, stage: 'production' }))
      .toThrowError('preview_only')
    expect(() => validateAttendanceScanLoadTarget({ ...valid, baseUrl: 'http://pika-preview.example.test' }))
      .toThrowError('invalid_base_url')
    expect(() => validateAttendanceScanLoadTarget({ ...valid, expectedOrigin: 'https://other.example.test' }))
      .toThrowError('origin_mismatch')
    expect(() => validateAttendanceScanLoadTarget({ ...valid, caseCount: 31 }))
      .toThrowError('invalid_concurrency')
  })

  it('uses nearest-rank percentiles', () => {
    const values = Array.from({ length: 100 }, (_, index) => index + 1)
    expect(nearestRankPercentile(values, 50)).toBe(50)
    expect(nearestRankPercentile(values, 95)).toBe(95)
    expect(nearestRankPercentile(values, 99)).toBe(99)
  })

  it('reports aggregate closed results and latency without returning credentials', async () => {
    let clock = 0
    const now = vi.fn(() => {
      clock += 10
      return clock
    })
    const fetchImpl = vi.fn<typeof fetch>(async (_url, request) => {
      const cookie = new Headers(request?.headers).get('Cookie') ?? ''
      const index = Number(/pika_session=pika-(\d+)/.exec(cookie)?.[1])
      if (index === 28) return new Response('{}', { status: 503 })
      if (index === 29) {
        return Response.json({
          state: 'closed',
          title: 'Check-in is closed',
          description: 'Ask your teacher for help.',
        })
      }
      return Response.json({
        state: index === 0 ? 'already_checked_in' : 'checked_in',
        title: 'Attendance confirmed',
        description: 'Your teacher can see this check-in.',
        attendanceStatus: 'present',
        recordedAt: '2026-08-18T13:00:00.000Z',
      })
    })

    const result = await runAttendanceScanLoad({
      cases: loadCases(),
      baseOrigin: 'https://pika-preview.example.test',
      fetchImpl,
      now,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(30)
    expect(result).toMatchObject({
      attempted: 30,
      confirmed: 28,
      rejected: 1,
      transportFailures: 1,
      concurrency: 30,
      stateCounts: { checked_in: 27, already_checked_in: 1, closed: 1 },
    })
    expect(result.latencyMs).toEqual({ min: 300, p50: 300, p95: 300, p99: 300, max: 300 })
    expect(JSON.stringify(result)).not.toContain('pika-')
    expect(JSON.stringify(result)).not.toContain('workos-')
    expect(JSON.stringify(result)).not.toContain(entryToken)
  })
})
