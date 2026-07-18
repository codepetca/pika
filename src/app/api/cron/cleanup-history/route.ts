import { NextRequest, NextResponse } from 'next/server'
import { formatInTimeZone } from 'date-fns-tz'
import { subDays } from 'date-fns'
import { getServiceRoleClient } from '@/lib/supabase'
import { withErrorHandler } from '@/lib/api-handler'
import {
  isClassroomArchiveObjectCleanupEnabled,
  resolveClassroomArchiveObjectCleanupLeaseToken,
  runClassroomArchiveObjectCleanup,
} from '@/lib/server/classroom-archive-object-cleanup'
import { chunkValues, loadChunkedRows, loadPagedRows } from '@/lib/server/query-chunks'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const TIMEZONE = 'America/Toronto'
const DELETE_CHUNK_SIZE = 200
const CLEANUP_PAGE_SIZE = 1000
const SAVE_OPERATION_RETENTION_DAYS = 35

type IdRow = { id: string }

function isArchiveStagingCleanupEnabled(): boolean {
  return process.env.CLASSROOM_ARCHIVE_STAGING_CLEANUP_ENABLED
    ?.trim()
    .toLowerCase() === 'true'
}

function getCronAuthHeader(request: NextRequest): string | null {
  return request.headers.get('authorization') ?? request.headers.get('Authorization')
}

async function loadExpiredClassroomIds(
  supabase: any,
  cutoffDate: string
): Promise<{ ids: string[]; error: any }> {
  const { rows, error } = await loadPagedRows<IdRow>(() =>
    supabase
      .from('classrooms')
      .select('id')
      .not('end_date', 'is', null)
      .lt('end_date', cutoffDate),
    CLEANUP_PAGE_SIZE
  )

  if (error) return { ids: [], error }
  return { ids: rows.map((row) => row.id), error: null }
}

async function loadIdsByParentIds(
  supabase: any,
  table: string,
  parentColumn: string,
  parentIds: string[]
): Promise<{ ids: string[]; error: any }> {
  if (parentIds.length === 0) return { ids: [], error: null }

  const { rows, error } = await loadChunkedRows<IdRow>({
    supabase,
    table,
    select: 'id',
    filters: [{ column: parentColumn, values: parentIds }],
    pageSize: CLEANUP_PAGE_SIZE,
  })

  if (error) return { ids: [], error }
  return { ids: rows.map((row) => row.id), error: null }
}

async function deleteHistoryByParentIds(
  supabase: any,
  table: string,
  parentColumn: string,
  parentIds: string[],
  preservedTrigger?: string
): Promise<{ deleted: number; error: any }> {
  let deleted = 0

  for (const parentIdChunk of chunkValues(parentIds, DELETE_CHUNK_SIZE)) {
    let deleteQuery = supabase
      .from(table)
      .delete({ count: 'exact' })
    if (preservedTrigger) {
      deleteQuery = deleteQuery.neq('trigger', preservedTrigger)
    }
    const { count, error } = await deleteQuery.in(parentColumn, parentIdChunk)

    if (error) return { deleted, error }
    deleted += count ?? 0
  }

  return { deleted, error: null }
}

async function handle(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('CRON_SECRET is not set')
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 500 }
    )
  }

  const authHeader = getCronAuthHeader(request)
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cutoffDate = formatInTimeZone(
    subDays(new Date(), 30),
    TIMEZONE,
    'yyyy-MM-dd'
  )

  const supabase = getServiceRoleClient()
  const objectCleanupEnabled = isClassroomArchiveObjectCleanupEnabled()
  let archiveStagingCleaned: number | undefined
  if (isArchiveStagingCleanupEnabled() || objectCleanupEnabled) {
    const response = await supabase.rpc('cleanup_expired_classroom_archive_snapshots')
    if (
      response.error
      || !Number.isSafeInteger(response.data)
      || response.data < 0
    ) {
      console.error('Error cleaning expired classroom archive staging:', response.error)
      return NextResponse.json(
        { error: 'Failed to clean classroom archive staging' },
        { status: 500 },
      )
    }
    archiveStagingCleaned = response.data
  }
  let archiveObjectCleanup: { claimed: number; deleted: number; failed: number } | undefined
  if (objectCleanupEnabled) {
    const result = await runClassroomArchiveObjectCleanup({
      supabase,
      leaseToken: resolveClassroomArchiveObjectCleanupLeaseToken(),
    })
    if (!result.ok || result.retry_recording_failed > 0) {
      console.error(
        'Error cleaning abandoned classroom archive objects:',
        result.ok ? 'archive_object_cleanup_retry_unrecorded' : result.error_code,
      )
      return NextResponse.json(
        { error: 'Failed to clean classroom archive objects' },
        { status: 503 },
      )
    }
    archiveObjectCleanup = {
      claimed: result.claimed,
      deleted: result.deleted,
      failed: result.failed,
    }
  }

  const saveOperationCutoff = subDays(new Date(), SAVE_OPERATION_RETENTION_DAYS).toISOString()
  const saveOperationCleanup = await supabase.rpc(
    'cleanup_assignment_doc_save_operations',
    { p_completed_before: saveOperationCutoff }
  )
  const saveOperationCleanupCount = saveOperationCleanup.data
  if (
    saveOperationCleanup.error
    || typeof saveOperationCleanupCount !== 'number'
    || !Number.isSafeInteger(saveOperationCleanupCount)
    || saveOperationCleanupCount < 0
  ) {
    console.error('Error cleaning assignment save operation digests:', saveOperationCleanup.error)
    return NextResponse.json(
      { error: 'Failed to clean assignment save operations' },
      { status: 500 }
    )
  }

  const { ids: classroomIds, error: classroomsError } = await loadExpiredClassroomIds(
    supabase,
    cutoffDate
  )

  if (classroomsError) {
    console.error('Error fetching classrooms for cleanup:', classroomsError)
    return NextResponse.json(
      { error: 'Failed to fetch classrooms' },
      { status: 500 }
    )
  }

  if (classroomIds.length === 0) {
    return NextResponse.json({
      status: 'ok',
      deleted: 0,
      ...(archiveStagingCleaned === undefined
        ? {}
        : { archive_staging_cleaned: archiveStagingCleaned }),
      ...(archiveObjectCleanup === undefined
        ? {}
        : { archive_object_cleanup: archiveObjectCleanup }),
    })
  }

  let deleted = 0

  const { ids: assignmentIds, error: assignmentsError } = await loadIdsByParentIds(
    supabase,
    'assignments',
    'classroom_id',
    classroomIds
  )

  if (assignmentsError) {
    console.error('Error fetching assignments for cleanup:', assignmentsError)
    return NextResponse.json(
      { error: 'Failed to fetch assignments' },
      { status: 500 }
    )
  }

  const { ids: assignmentDocIds, error: docsError } = await loadIdsByParentIds(
    supabase,
    'assignment_docs',
    'assignment_id',
    assignmentIds
  )

  if (docsError) {
    console.error('Error fetching assignment docs for cleanup:', docsError)
    return NextResponse.json(
      { error: 'Failed to fetch assignment docs' },
      { status: 500 }
    )
  }

  const { deleted: assignmentHistoryDeleted, error: assignmentHistoryError } =
    await deleteHistoryByParentIds(
      supabase,
      'assignment_doc_history',
      'assignment_doc_id',
      assignmentDocIds,
      'submit'
    )

  if (assignmentHistoryError) {
    console.error('Error deleting assignment doc history:', assignmentHistoryError)
    return NextResponse.json(
      { error: 'Failed to delete history' },
      { status: 500 }
    )
  }
  deleted += assignmentHistoryDeleted

  const { ids: testIds, error: testsError } = await loadIdsByParentIds(
    supabase,
    'tests',
    'classroom_id',
    classroomIds
  )

  if (testsError) {
    console.error('Error fetching tests for cleanup:', testsError)
    return NextResponse.json(
      { error: 'Failed to fetch tests' },
      { status: 500 }
    )
  }

  const { ids: testAttemptIds, error: attemptsError } = await loadIdsByParentIds(
    supabase,
    'test_attempts',
    'test_id',
    testIds
  )

  if (attemptsError) {
    console.error('Error fetching test attempts for cleanup:', attemptsError)
    return NextResponse.json(
      { error: 'Failed to fetch test attempts' },
      { status: 500 }
    )
  }

  const { deleted: testHistoryDeleted, error: testHistoryError } =
    await deleteHistoryByParentIds(
      supabase,
      'test_attempt_history',
      'test_attempt_id',
      testAttemptIds
    )

  if (testHistoryError) {
    console.error('Error deleting test attempt history:', testHistoryError)
    return NextResponse.json(
      { error: 'Failed to delete history' },
      { status: 500 }
    )
  }
  deleted += testHistoryDeleted

  return NextResponse.json({
    status: 'ok',
    deleted,
    ...(archiveStagingCleaned === undefined
      ? {}
      : { archive_staging_cleaned: archiveStagingCleaned }),
    ...(archiveObjectCleanup === undefined
      ? {}
      : { archive_object_cleanup: archiveObjectCleanup }),
  })
}

export const GET = withErrorHandler('GetCronCleanupHistory', async (request: NextRequest) => {
  return handle(request)
})

export const POST = withErrorHandler('PostCronCleanupHistory', async (request: NextRequest) => {
  return handle(request)
})
