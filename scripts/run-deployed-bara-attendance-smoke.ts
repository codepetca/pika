import { runDeployedBaraAttendanceSmoke } from './deployed-bara-attendance-smoke-runner'

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  return process.argv[index + 1]?.trim() || undefined
}

const stage = readArgument('--stage')
const attendanceMode = readArgument('--mode')
const attendanceScopeMode = readArgument('--scope-mode')
const targetScopeMode = readArgument('--target-scope-mode')
const expectedPikaOrigin = readArgument('--expected-pika-origin')

if (
  (stage !== 'preview' && stage !== 'production')
  || (attendanceMode !== 'pre-enable' && attendanceMode !== 'enabled')
  || (attendanceScopeMode !== 'exact_canary' && attendanceScopeMode !== 'teacher_entitlements')
  || (targetScopeMode !== 'exact_canary' && targetScopeMode !== 'teacher_entitlements')
  || !expectedPikaOrigin
) {
  process.stderr.write(
    'Deployed attendance smoke requires rollout mode, runtime and target scope modes, preview/production stage, and exact Pika origin.\n',
  )
  process.exit(2)
}

async function main() {
  const result = await runDeployedBaraAttendanceSmoke({
    stage,
    attendanceMode,
    attendanceScopeMode,
    targetScopeMode,
    expectedPikaOrigin,
    configuredPikaOrigin: process.env.NEXT_PUBLIC_APP_URL ?? '',
    readOperatorSecret: () => process.env.BARA_ATTENDANCE_SMOKE_OPERATOR_SECRET ?? '',
  })

  if (result.error) process.stderr.write(`${result.error}\n`)
  if (result.output) process.stdout.write(`${JSON.stringify(result.output, null, 2)}\n`)
  if (result.exitCode !== 0) process.exitCode = result.exitCode
}

void main()
