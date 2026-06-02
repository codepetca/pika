import { config } from 'dotenv'
import { runPikaGradexSmoke, buildPikaGradexSmokeSample } from '@/lib/server/gradex-smoke-runner'

config({ path: '.env.local' })

const args = new Set(process.argv.slice(2))

async function main() {
  if (args.has('--dry-run')) {
    const sample = buildPikaGradexSmokeSample()
    console.log(JSON.stringify(sample, null, 2))
    return
  }

  const baseUrl = requiredEnv('GRADEX_API_URL')
  const apiKey = requiredEnv('GRADEX_API_KEY')
  const internalToken = process.env.GRADEX_INTERNAL_TOKEN?.trim() || process.env.GRADEX_INTERNAL_SECRET?.trim()
  const pollAttempts = parsePositiveInt(process.env.GRADEX_SMOKE_POLL_ATTEMPTS, 20)
  const pollIntervalMs = parsePositiveInt(process.env.GRADEX_SMOKE_POLL_INTERVAL_MS, 1500)

  const report = await runPikaGradexSmoke({
    baseUrl,
    apiKey,
    internalToken,
    pollAttempts,
    pollIntervalMs,
  })

  console.log(JSON.stringify({
    run: report.run,
    grade_records: report.gradeRecords,
    poll_attempts: report.pollAttempts,
    sanitized_preview: report.sample.sanitizedPreview,
  }, null, 2))
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required. Use --dry-run to inspect the sanitized sample without calling Gradex.`)
  }
  return value
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
