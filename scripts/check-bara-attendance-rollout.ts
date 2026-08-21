import {
  auditBaraAttendanceRolloutEnvironment,
  type BaraAttendanceRolloutStage,
} from '../src/lib/server/bara-attendance-rollout'

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  const value = process.argv[index + 1]?.trim()
  return value || undefined
}

const stage = readArgument('--stage')
const expectedSupabaseRef = readArgument('--expected-supabase-ref')
const productionSupabaseRef = readArgument('--production-supabase-ref')
const expectedPikaOrigin = readArgument('--expected-pika-origin')
const expectedBaraApiOrigin = readArgument('--expected-bara-api-origin')

if (
  (stage !== 'preview' && stage !== 'production')
  || !expectedSupabaseRef
  || !productionSupabaseRef
  || !expectedPikaOrigin
  || !expectedBaraApiOrigin
) {
  process.stderr.write(
    'Attendance rollout preflight requires stage, exact Supabase refs, and exact Pika/Bara API origins.\n',
  )
  process.exit(2)
}

const result = auditBaraAttendanceRolloutEnvironment(process.env, {
  stage: stage as BaraAttendanceRolloutStage,
  expectedSupabaseRef,
  productionSupabaseRef,
  expectedPikaOrigin,
  expectedBaraApiOrigin,
})

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
if (!result.ready) process.exit(1)
