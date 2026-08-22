import {
  auditBaraAttendanceRolloutEnvironment,
  type BaraAttendanceRolloutMode,
  type BaraAttendanceRolloutStage,
} from '../src/lib/server/bara-attendance-rollout'
import { auditBaraAttendanceCanaryDatabaseScope } from '../src/lib/server/bara-attendance-canary'
import { getServiceRoleClient } from '../src/lib/supabase'

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  const value = process.argv[index + 1]?.trim()
  return value || undefined
}

const stage = readArgument('--stage')
const attendanceMode = readArgument('--mode')
const expectedSupabaseRef = readArgument('--expected-supabase-ref')
const productionSupabaseRef = readArgument('--production-supabase-ref')
const expectedPikaOrigin = readArgument('--expected-pika-origin')
const expectedBaraApiOrigin = readArgument('--expected-bara-api-origin')

if (
  (stage !== 'preview' && stage !== 'production')
  || (attendanceMode !== 'pre-enable' && attendanceMode !== 'enabled')
  || !expectedSupabaseRef
  || !productionSupabaseRef
  || !expectedPikaOrigin
  || !expectedBaraApiOrigin
) {
  process.stderr.write(
    'Attendance rollout preflight requires mode, stage, exact Supabase refs, and exact Pika/Bara API origins.\n',
  )
  process.exit(2)
}

async function main() {
  const environmentResult = auditBaraAttendanceRolloutEnvironment(process.env, {
    stage: stage as BaraAttendanceRolloutStage,
    attendanceMode: attendanceMode as BaraAttendanceRolloutMode,
    expectedSupabaseRef: expectedSupabaseRef!,
    productionSupabaseRef: productionSupabaseRef!,
    expectedPikaOrigin: expectedPikaOrigin!,
    expectedBaraApiOrigin: expectedBaraApiOrigin!,
  })

  let databaseReady = false
  if (environmentResult.ready) {
    try {
      const databaseResult = await auditBaraAttendanceCanaryDatabaseScope({
        supabase: getServiceRoleClient(),
        teacherId: process.env.PIKA_BARA_ATTENDANCE_CANARY_TEACHER_ID?.trim() ?? '',
        classroomId: process.env.PIKA_BARA_ATTENDANCE_CANARY_CLASSROOM_ID?.trim() ?? '',
      })
      databaseReady = databaseResult.ready
    } catch {
      databaseReady = false
    }
  }

  const failedChecks = [
    ...environmentResult.failedChecks,
    ...(databaseReady ? [] : ['attendance_canary_database_scope']),
  ]
  const result = {
    ...environmentResult,
    ready: failedChecks.length === 0,
    passedCount: environmentResult.passedCount + (databaseReady ? 1 : 0),
    checkCount: environmentResult.checkCount + 1,
    failedChecks,
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (!result.ready) process.exitCode = 1
}

void main()
