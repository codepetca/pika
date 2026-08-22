export type DeployedSmokeRunnerResult = {
  exitCode: 0 | 1 | 2
  output?: Record<string, unknown>
  error?: string
}

function exactProductionOrigin(value: string) {
  const url = new URL(value)
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
  ) throw new Error('invalid_origin')
  return url.origin
}

export async function runDeployedBaraAttendanceSmoke(input: {
  stage: 'preview' | 'production'
  expectedPikaOrigin: string
  configuredPikaOrigin: string
  readOperatorSecret: () => string
  fetcher?: typeof fetch
}): Promise<DeployedSmokeRunnerResult> {
  if (input.stage === 'preview') {
    return {
      exitCode: 0,
      output: {
        status: 'skipped',
        reason: 'production_only_no_staging_database',
        rolloutGateSatisfied: false,
      },
    }
  }

  let origin: string
  try {
    origin = exactProductionOrigin(input.expectedPikaOrigin)
    if (origin !== exactProductionOrigin(input.configuredPikaOrigin)) {
      throw new Error('origin_mismatch')
    }
  } catch {
    return {
      exitCode: 2,
      error: 'Deployed attendance smoke requires the exact configured HTTPS Pika origin.',
    }
  }

  const operatorSecret = input.readOperatorSecret()
  if (operatorSecret.length < 32) {
    return {
      exitCode: 1,
      error: 'Deployed attendance smoke operator authentication is not configured.',
    }
  }

  let result: unknown = null
  try {
    const response = await (input.fetcher ?? fetch)(
      `${origin}/api/cron/bara-attendance-smoke`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${operatorSecret}` },
        signal: AbortSignal.timeout(20_000),
      },
    )
    const text = (await response.text()).slice(0, 4_096)
    result = JSON.parse(text) as unknown
  } catch {
    result = null
  }
  const record = typeof result === 'object' && result !== null && !Array.isArray(result)
    ? result as Record<string, unknown>
    : null
  const checks = record && typeof record.checks === 'object'
    && record.checks !== null && !Array.isArray(record.checks)
    ? record.checks as Record<string, unknown>
    : null
  const passed = record?.status === 'passed'
    && checks?.canaryScope === true
    && checks.pikaToBara === true
    && checks.baraToPika === true
    && Object.keys(checks).length === 3
  return {
    exitCode: passed ? 0 : 1,
    output: passed
      ? { status: 'passed', rolloutGateSatisfied: true, checksPassed: 3, checksTotal: 3 }
      : { status: 'failed', rolloutGateSatisfied: false, checksPassed: 0, checksTotal: 3 },
  }
}
