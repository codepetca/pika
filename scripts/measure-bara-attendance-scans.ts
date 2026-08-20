import { readFile, stat } from 'node:fs/promises'
import {
  AttendanceScanLoadConfigurationError,
  parseAttendanceScanLoadManifest,
  runAttendanceScanLoad,
  validateAttendanceScanLoadTarget,
} from '../src/lib/server/bara-attendance-load'

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  const value = process.argv[index + 1]?.trim()
  return value || undefined
}

async function main(): Promise<void> {
  const stage = readArgument('--stage')
  const manifestPath = readArgument('--manifest')
  const baseUrl = readArgument('--base-url')
  const expectedOrigin = readArgument('--expected-origin')
  const concurrency = Number(readArgument('--concurrency'))
  const timeoutArgument = readArgument('--timeout-ms')
  const timeoutMs = timeoutArgument === undefined ? undefined : Number(timeoutArgument)

  if (!stage || !manifestPath || !baseUrl || !expectedOrigin) {
    throw new AttendanceScanLoadConfigurationError('missing_arguments')
  }

  const baseOrigin = validateAttendanceScanLoadTarget({
    stage,
    baseUrl,
    expectedOrigin,
    concurrency,
    caseCount: concurrency,
  })

  const manifestStats = await stat(manifestPath)
  if (!manifestStats.isFile() || (manifestStats.mode & 0o077) !== 0) {
    throw new AttendanceScanLoadConfigurationError('unsafe_manifest_permissions')
  }
  let manifestValue: unknown
  try {
    manifestValue = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown
  } catch {
    throw new AttendanceScanLoadConfigurationError('invalid_manifest')
  }
  const manifest = parseAttendanceScanLoadManifest(manifestValue)
  validateAttendanceScanLoadTarget({
    stage,
    baseUrl,
    expectedOrigin,
    concurrency,
    caseCount: manifest.cases.length,
  })
  const result = await runAttendanceScanLoad({
    cases: manifest.cases,
    baseOrigin,
    timeoutMs,
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (result.confirmed !== result.attempted) process.exitCode = 1
}

main().catch((error: unknown) => {
  const code = error instanceof AttendanceScanLoadConfigurationError
    ? error.code
    : 'measurement_failed'
  process.stderr.write(`Attendance scan load measurement failed: ${code}.\n`)
  process.exitCode = 2
})
