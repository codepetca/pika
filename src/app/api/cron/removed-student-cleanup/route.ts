import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import {
  AUTOMATIC_REMOVED_STUDENT_CLEANUP_MAX_ADVANCES,
  AUTOMATIC_REMOVED_STUDENT_CLEANUP_MAX_CLAIMS,
  AUTOMATIC_REMOVED_STUDENT_CLEANUP_TIME_BUDGET_MS,
  isAutomaticRemovedStudentCleanupEnabled,
  runAutomaticRemovedStudentCleanup,
} from '@/lib/server/automatic-removed-student-cleanup'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

async function handle(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAutomaticRemovedStudentCleanupEnabled()) return NextResponse.json({
    ok: false, status: 503, error_code: 'automatic_removed_student_cleanup_not_enabled',
  }, { status: 503 })
  const result = await runAutomaticRemovedStudentCleanup({
    maxClaims: AUTOMATIC_REMOVED_STUDENT_CLEANUP_MAX_CLAIMS,
    maxAdvances: AUTOMATIC_REMOVED_STUDENT_CLEANUP_MAX_ADVANCES,
    timeBudgetMs: AUTOMATIC_REMOVED_STUDENT_CLEANUP_TIME_BUDGET_MS,
  })
  return NextResponse.json(result, { status: result.status })
}

export const GET = withErrorHandler('GetCronRemovedStudentCleanup', handle)
export const POST = withErrorHandler('PostCronRemovedStudentCleanup', handle)
