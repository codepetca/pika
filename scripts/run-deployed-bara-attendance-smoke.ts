function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  return process.argv[index + 1]?.trim() || undefined
}

const stage = readArgument('--stage')
const expectedPikaOrigin = readArgument('--expected-pika-origin')

if ((stage !== 'preview' && stage !== 'production') || !expectedPikaOrigin) {
  process.stderr.write('Deployed attendance smoke requires preview/production stage and exact Pika origin.\n')
  process.exit(2)
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

async function main() {
  if (stage === 'preview') {
    process.stdout.write(`${JSON.stringify({
      status: 'skipped',
      reason: 'production_only_no_staging_database',
      rolloutGateSatisfied: false,
    }, null, 2)}\n`)
    return
  }

  let origin: string
  try {
    origin = exactProductionOrigin(expectedPikaOrigin!)
  } catch {
    process.stderr.write('Deployed attendance smoke requires an exact HTTPS Pika origin.\n')
    process.exitCode = 2
    return
  }
  const operatorSecret = process.env.CRON_SECRET ?? ''
  if (operatorSecret.length < 32) {
    process.stderr.write('Deployed attendance smoke operator authentication is not configured.\n')
    process.exitCode = 1
    return
  }

  let result: unknown = null
  try {
    const response = await fetch(`${origin}/api/cron/bara-attendance-smoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${operatorSecret}` },
      signal: AbortSignal.timeout(20_000),
    })
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
  const aggregate = passed
    ? { status: 'passed', rolloutGateSatisfied: true, checksPassed: 3, checksTotal: 3 }
    : { status: 'failed', rolloutGateSatisfied: false, checksPassed: 0, checksTotal: 3 }
  process.stdout.write(`${JSON.stringify(aggregate, null, 2)}\n`)
  if (!passed) process.exitCode = 1
}

void main()
