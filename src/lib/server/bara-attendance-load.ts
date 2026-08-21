import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { studentAttendanceCheckInViewSchema } from '@/lib/validations/student-attendance'

const MIN_CONCURRENT_SCANS = 30
const MAX_CONCURRENT_SCANS = 100

const scanCaseSchema = z.object({
  cookie: z.string().min(1).max(8192).refine(
    (value) => !value.includes('\r') && !value.includes('\n'),
    'Cookie must be a single header value',
  ),
  entryToken: z.string().regex(/^[A-Za-z0-9_-]{80,768}$/),
}).strict()

const scanManifestSchema = z.object({
  cases: z.array(scanCaseSchema).min(MIN_CONCURRENT_SCANS).max(MAX_CONCURRENT_SCANS),
}).strict().superRefine(({ cases }, context) => {
  const localSessions = cases.map(({ cookie }) => readCookie(cookie, 'pika_session'))
  const workosSessions = cases.map(({ cookie }) => readCookie(cookie, 'pika-wos-session'))
  if (
    localSessions.some((value) => !value)
    || workosSessions.some((value) => !value)
    || new Set(localSessions).size !== cases.length
    || new Set(workosSessions).size !== cases.length
  ) {
    context.addIssue({
      code: 'custom',
      path: ['cases'],
      message: 'Each scan must use distinct Pika and WorkOS student sessions',
    })
  }
})

export type AttendanceScanLoadCase = z.infer<typeof scanCaseSchema>
export type AttendanceScanLoadManifest = z.infer<typeof scanManifestSchema>

export type AttendanceScanLoadResult = {
  attempted: number
  confirmed: number
  rejected: number
  transportFailures: number
  concurrency: number
  durationMs: number
  requestsPerSecond: number
  stateCounts: Partial<Record<'checked_in' | 'already_checked_in' | 'needs_staff' | 'closed' | 'invalid', number>>
  latencyMs: {
    min: number
    p50: number
    p95: number
    p99: number
    max: number
  }
}

export class AttendanceScanLoadConfigurationError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'AttendanceScanLoadConfigurationError'
  }
}

function readCookie(header: string, name: string): string | undefined {
  for (const field of header.split(';')) {
    const separator = field.indexOf('=')
    if (separator === -1 || field.slice(0, separator).trim() !== name) continue
    return field.slice(separator + 1).trim() || undefined
  }
  return undefined
}

export function parseAttendanceScanLoadManifest(value: unknown): AttendanceScanLoadManifest {
  const parsed = scanManifestSchema.safeParse(value)
  if (!parsed.success) {
    throw new AttendanceScanLoadConfigurationError('invalid_manifest')
  }
  return parsed.data
}

function parseExactOrigin(value: string, code: string): URL {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new AttendanceScanLoadConfigurationError(code)
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || (parsed.pathname !== '/' && parsed.pathname !== '')
    || parsed.search
    || parsed.hash
  ) {
    throw new AttendanceScanLoadConfigurationError(code)
  }
  return parsed
}

export function validateAttendanceScanLoadTarget(input: {
  stage: string
  baseUrl: string
  expectedOrigin: string
  concurrency: number
  caseCount: number
}): string {
  if (input.stage !== 'preview') {
    throw new AttendanceScanLoadConfigurationError('preview_only')
  }
  if (
    !Number.isInteger(input.concurrency)
    || input.concurrency < MIN_CONCURRENT_SCANS
    || input.concurrency > MAX_CONCURRENT_SCANS
    || input.caseCount !== input.concurrency
  ) {
    throw new AttendanceScanLoadConfigurationError('invalid_concurrency')
  }
  const baseUrl = parseExactOrigin(input.baseUrl, 'invalid_base_url')
  const expectedOrigin = parseExactOrigin(input.expectedOrigin, 'invalid_expected_origin')
  if (baseUrl.origin !== expectedOrigin.origin) {
    throw new AttendanceScanLoadConfigurationError('origin_mismatch')
  }
  return baseUrl.origin
}

export function nearestRankPercentile(values: number[], percentile: number): number {
  if (values.length === 0 || percentile <= 0 || percentile > 100) {
    throw new AttendanceScanLoadConfigurationError('invalid_percentile')
  }
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.ceil((percentile / 100) * sorted.length) - 1]
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10
}

export async function runAttendanceScanLoad(input: {
  cases: AttendanceScanLoadCase[]
  baseOrigin: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  now?: () => number
}): Promise<AttendanceScanLoadResult> {
  const fetchImpl = input.fetchImpl ?? fetch
  const now = input.now ?? performance.now.bind(performance)
  const timeoutMs = input.timeoutMs ?? 15_000
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
    throw new AttendanceScanLoadConfigurationError('invalid_timeout')
  }

  const startedAt = now()
  const outcomes = await Promise.all(input.cases.map(async (scanCase) => {
    const requestStartedAt = now()
    try {
      const response = await fetchImpl(`${input.baseOrigin}/api/student/attendance/check-in`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: scanCase.cookie,
        },
        body: JSON.stringify({
          entryToken: scanCase.entryToken,
          attemptId: randomUUID(),
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      })
      const latencyMs = now() - requestStartedAt
      if (!response.ok) return { kind: 'transport_failure' as const, latencyMs }
      const result = studentAttendanceCheckInViewSchema.safeParse(await response.json())
      if (!result.success) return { kind: 'transport_failure' as const, latencyMs }
      return { kind: 'closed_result' as const, latencyMs, state: result.data.state }
    } catch {
      return { kind: 'transport_failure' as const, latencyMs: now() - requestStartedAt }
    }
  }))
  const durationMs = now() - startedAt
  const latencyValues = outcomes.map(({ latencyMs }) => latencyMs)
  const stateCounts: AttendanceScanLoadResult['stateCounts'] = {}
  let confirmed = 0
  let rejected = 0
  let transportFailures = 0

  for (const outcome of outcomes) {
    if (outcome.kind === 'transport_failure') {
      transportFailures += 1
      continue
    }
    stateCounts[outcome.state] = (stateCounts[outcome.state] ?? 0) + 1
    if (outcome.state === 'checked_in' || outcome.state === 'already_checked_in') {
      confirmed += 1
    } else {
      rejected += 1
    }
  }

  return {
    attempted: outcomes.length,
    confirmed,
    rejected,
    transportFailures,
    concurrency: outcomes.length,
    durationMs: rounded(durationMs),
    requestsPerSecond: rounded(durationMs > 0 ? outcomes.length / (durationMs / 1000) : 0),
    stateCounts,
    latencyMs: {
      min: rounded(Math.min(...latencyValues)),
      p50: rounded(nearestRankPercentile(latencyValues, 50)),
      p95: rounded(nearestRankPercentile(latencyValues, 95)),
      p99: rounded(nearestRankPercentile(latencyValues, 99)),
      max: rounded(Math.max(...latencyValues)),
    },
  }
}
