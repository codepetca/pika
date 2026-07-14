import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import {
  CLASSROOM_ARCHIVE_SOURCE_CLEANUP_DEFAULT_LEASE_SECONDS,
  isClassroomArchiveSourceCleanupTriggerEnabled,
  resolveClassroomArchiveSourceCleanupLeaseToken,
  resolveClassroomArchiveSourceCleanupOperationId,
  runClassroomArchiveSourceCleanup,
} from '@/lib/server/classroom-archive-source-cleanup'
import { getServiceRoleClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

const CLEANUP_CANARY_LIMIT = 1
const OWNERSHIP_VERIFIER_IMPLEMENTED = false

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

  const leaseToken = resolveClassroomArchiveSourceCleanupLeaseToken()
  if (!isClassroomArchiveSourceCleanupTriggerEnabled()) {
    return NextResponse.json({
      ok: false,
      status: 503,
      lease_token: leaseToken,
      error_code: 'classroom_archive_source_cleanup_trigger_not_enabled',
      error: 'Classroom archive source cleanup trigger is not enabled',
      retryable: true,
    }, { status: 503 })
  }

  if (!OWNERSHIP_VERIFIER_IMPLEMENTED) {
    return NextResponse.json({
      ok: false,
      status: 503,
      lease_token: leaseToken,
      error_code: 'classroom_archive_source_cleanup_ownership_verifier_required',
      error: 'Classroom archive source cleanup ownership verification is not implemented',
      retryable: false,
    }, { status: 503 })
  }

  const configuredOperationId = process.env.CLASSROOM_ARCHIVE_SOURCE_CLEANUP_OPERATION_ID
  if (!configuredOperationId) {
    return NextResponse.json({
      ok: false,
      status: 503,
      lease_token: leaseToken,
      error_code: 'classroom_archive_source_cleanup_operation_not_configured',
      error: 'Classroom archive source cleanup operation is not configured',
      retryable: true,
    }, { status: 503 })
  }
  const operationId = resolveClassroomArchiveSourceCleanupOperationId(configuredOperationId)

  const result = await runClassroomArchiveSourceCleanup({
    supabase: getServiceRoleClient(),
    leaseToken,
    operationId,
    limit: CLEANUP_CANARY_LIMIT,
    leaseSeconds: CLASSROOM_ARCHIVE_SOURCE_CLEANUP_DEFAULT_LEASE_SECONDS,
  })

  if (!result.ok) {
    return NextResponse.json(result, { status: result.status })
  }

  if (result.retry_recording_failed > 0) {
    return NextResponse.json({
      ok: false,
      status: 503,
      error_code: 'archive_source_cleanup_batch_unhealthy',
      error: 'Classroom archive source cleanup completed without durable evidence for every claim',
      retryable: true,
      batch: result,
    }, { status: 503 })
  }

  return NextResponse.json(result, { status: result.status })
}

export const GET = withErrorHandler(
  'GetCronClassroomArchiveSourceCleanup',
  async (request: NextRequest) => handle(request),
)

export const POST = withErrorHandler(
  'PostCronClassroomArchiveSourceCleanup',
  async (request: NextRequest) => handle(request),
)
