import { NextRequest, NextResponse } from 'next/server'
import { formatInTimeZone } from 'date-fns-tz'
import { subDays } from 'date-fns'
import { getServiceRoleClient } from '@/lib/supabase'
import { withErrorHandler } from '@/lib/api-handler'
import { chunkValues, loadChunkedRows, loadPagedRows } from '@/lib/server/query-chunks'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const TIMEZONE = 'America/Toronto'
const DELETE_CHUNK_SIZE = 200
const CLEANUP_PAGE_SIZE = 1000

type IdRow = { id: string }

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
  parentIds: string[]
): Promise<{ deleted: number; error: any }> {
  let deleted = 0

  for (const parentIdChunk of chunkValues(parentIds, DELETE_CHUNK_SIZE)) {
    const { count, error } = await supabase
      .from(table)
      .delete({ count: 'exact' })
      .in(parentColumn, parentIdChunk)

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
    return NextResponse.json({ status: 'ok', deleted: 0 })
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
      assignmentDocIds
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

  return NextResponse.json({ status: 'ok', deleted })
}

export const GET = withErrorHandler('GetCronCleanupHistory', async (request: NextRequest) => {
  return handle(request)
})

export const POST = withErrorHandler('PostCronCleanupHistory', async (request: NextRequest) => {
  return handle(request)
})
