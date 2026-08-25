import { config } from 'dotenv'
import { z } from 'zod'

import { PIKA_ATTENDANCE_PRODUCTION_TARGET } from '@/lib/server/bara-attendance-deployed-preflight'
import { readBaraAttendancePilotReadiness } from '@/lib/server/bara-attendance-pilot-readiness'
import { createTargetBoundFetch, verifyHostedSupabaseApiOrigin } from '@/lib/server/supabase-target'
import { getServiceRoleClient } from '@/lib/supabase'

config({ path: process.env.ENV_FILE || '.env.local' })

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  const value = process.argv[index + 1]?.trim()
  return value || undefined
}

async function main() {
  const stage = readArgument('--stage')
  if (stage !== 'production') {
    throw new Error('Attendance pilot readiness requires --stage production')
  }
  if (process.env.NEXT_PUBLIC_APP_URL !== PIKA_ATTENDANCE_PRODUCTION_TARGET.expectedPikaOrigin) {
    throw new Error('Attendance pilot readiness target is not the pinned Pika production origin')
  }
  if (process.env.PIKA_BARA_ATTENDANCE_ENABLED !== 'true') {
    throw new Error('Attendance pilot readiness requires the enabled production runtime')
  }
  if (process.env.PIKA_BARA_ATTENDANCE_SCOPE_MODE !== 'teacher_entitlements') {
    throw new Error('Attendance pilot readiness requires teacher_entitlements scope')
  }

  const teacherId = z.string().uuid().parse(
    process.env.PIKA_BARA_ATTENDANCE_CANARY_TEACHER_ID?.trim(),
  )
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl || !process.env.SUPABASE_SECRET_KEY) {
    throw new Error('Attendance pilot readiness requires production Supabase credentials')
  }
  const verifiedOrigin = verifyHostedSupabaseApiOrigin(
    supabaseUrl,
    PIKA_ATTENDANCE_PRODUCTION_TARGET.expectedSupabaseRef,
  )
  process.env.NEXT_PUBLIC_SUPABASE_URL = verifiedOrigin
  const result = await readBaraAttendancePilotReadiness({
    supabase: getServiceRoleClient({ fetch: createTargetBoundFetch(verifiedOrigin) }),
    teacherId,
  })

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (!result.readyForScopedSaveVerification) process.exitCode = 1
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown readiness failure'
  process.stderr.write(`Attendance pilot readiness failed: ${message}\n`)
  process.exitCode = 1
})
