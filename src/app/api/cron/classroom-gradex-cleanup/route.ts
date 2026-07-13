import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import {
  CLASSROOM_GRADEX_CLEANUP_DEFAULT_LEASE_SECONDS,
  isClassroomGradexCleanupTriggerEnabled,
  resolveClassroomGradexCleanupLeaseToken,
  runClassroomGradexCleanup,
} from '@/lib/server/classroom-gradex-cleanup'
import { getServiceRoleClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

const CLEANUP_CANARY_LIMIT = 1

function getCronAuthHeader(request: NextRequest): string | null {
  return request.headers.get('authorization') ?? request.headers.get('Authorization')
}

async function handle(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('CRON_SECRET is not set')
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 500 },
    )
  }

  if (getCronAuthHeader(request) !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const leaseToken = resolveClassroomGradexCleanupLeaseToken()
  if (!isClassroomGradexCleanupTriggerEnabled()) {
    return NextResponse.json({
      ok: false,
      status: 503,
      lease_token: leaseToken,
      error_code: 'classroom_gradex_cleanup_trigger_not_enabled',
      error: 'Classroom Gradex cleanup trigger is not enabled',
      retryable: true,
    }, { status: 503 })
  }

  const result = await runClassroomGradexCleanup({
    supabase: getServiceRoleClient(),
    leaseToken,
    limit: CLEANUP_CANARY_LIMIT,
    leaseSeconds: CLASSROOM_GRADEX_CLEANUP_DEFAULT_LEASE_SECONDS,
  })

  if (!result.ok) {
    return NextResponse.json(result, { status: result.status })
  }

  if (result.retry_recording_failed > 0) {
    return NextResponse.json({
      ok: false,
      status: 503,
      error_code: 'gradex_cleanup_batch_unhealthy',
      error: 'Gradex cleanup completed without durable evidence for every claim',
      retryable: true,
      batch: result,
    }, { status: 503 })
  }

  return NextResponse.json(result, { status: result.status })
}

export const GET = withErrorHandler(
  'GetCronClassroomGradexCleanup',
  async (request: NextRequest) => handle(request),
)

export const POST = withErrorHandler(
  'PostCronClassroomGradexCleanup',
  async (request: NextRequest) => handle(request),
)
