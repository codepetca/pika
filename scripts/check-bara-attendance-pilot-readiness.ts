import { config } from 'dotenv'
import { z } from 'zod'

import { PIKA_ATTENDANCE_PRODUCTION_TARGET } from '@/lib/server/bara-attendance-deployed-preflight'
import {
  createAttendancePilotReadOnlyFetch,
  readBaraAttendancePilotReadiness,
} from '@/lib/server/bara-attendance-pilot-readiness'
import { verifyHostedSupabaseApiOrigin } from '@/lib/server/supabase-target'
import { getServiceRoleClient } from '@/lib/supabase'

config({ path: process.env.ENV_FILE || '.env.local' })

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  const value = process.argv[index + 1]?.trim()
  return value || undefined
}

type OperatorFailure =
  | 'attendance_pilot_invalid_stage'
  | 'attendance_pilot_invalid_environment'
  | 'attendance_pilot_invalid_target'
  | 'attendance_pilot_read_failed'

class AttendancePilotOperatorError extends Error {
  constructor(readonly code: OperatorFailure) {
    super(code)
    this.name = 'AttendancePilotOperatorError'
  }
}

async function main() {
  const stage = readArgument('--stage')
  if (stage !== 'production') {
    throw new AttendancePilotOperatorError('attendance_pilot_invalid_stage')
  }
  if (process.env.NEXT_PUBLIC_APP_URL !== PIKA_ATTENDANCE_PRODUCTION_TARGET.expectedPikaOrigin) {
    throw new AttendancePilotOperatorError('attendance_pilot_invalid_target')
  }
  if (process.env.PIKA_BARA_ATTENDANCE_ENABLED !== 'true') {
    throw new AttendancePilotOperatorError('attendance_pilot_invalid_environment')
  }
  if (process.env.PIKA_BARA_ATTENDANCE_SCOPE_MODE !== 'teacher_entitlements') {
    throw new AttendancePilotOperatorError('attendance_pilot_invalid_environment')
  }

  const teacherId = z.string().uuid().parse(
    process.env.PIKA_BARA_ATTENDANCE_CANARY_TEACHER_ID?.trim(),
  )
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl || !process.env.SUPABASE_SECRET_KEY) {
    throw new AttendancePilotOperatorError('attendance_pilot_invalid_environment')
  }
  const verifiedOrigin = verifyHostedSupabaseApiOrigin(
    supabaseUrl,
    PIKA_ATTENDANCE_PRODUCTION_TARGET.expectedSupabaseRef,
  )
  process.env.NEXT_PUBLIC_SUPABASE_URL = verifiedOrigin
  const result = await readBaraAttendancePilotReadiness({
    supabase: getServiceRoleClient({
      fetch: createAttendancePilotReadOnlyFetch({
        expectedOrigin: verifiedOrigin,
        teacherId,
      }),
    }),
    teacherId,
  })

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (!result.readyForScopedSaveVerification) process.exitCode = 1
}

main().catch((error: unknown) => {
  const code = error instanceof AttendancePilotOperatorError
    ? error.code
    : 'attendance_pilot_read_failed'
  process.stderr.write(`Attendance pilot readiness failed: ${code}\n`)
  process.exitCode = 1
})
