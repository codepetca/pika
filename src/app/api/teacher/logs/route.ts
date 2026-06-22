import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { loadClassroomRoster } from '@/lib/server/classroom-roster'
import { assertTeacherOwnsClassroom } from '@/lib/server/classrooms'
import { chunkValues, loadChunkedRows } from '@/lib/server/query-chunks'
import type { Entry } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const HISTORY_PREVIEW_LIMIT = 5
const HISTORY_PREVIEW_STUDENT_CHUNK_SIZE = 50
const TEACHER_LOG_PAGE_SIZE = 1000
const ENTRY_SELECT = [
  'id',
  'student_id',
  'classroom_id',
  'date',
  'text',
  'rich_content',
  'version',
  'minutes_reported',
  'mood',
  'created_at',
  'updated_at',
  'on_time',
].join(', ')

type SupabaseClient = ReturnType<typeof getServiceRoleClient>

/**
 * GET /api/teacher/logs?classroom_id=xxx&date=YYYY-MM-DD
 * Returns roster students with an optional entry for the selected date.
 */
export const GET = withErrorHandler('GetTeacherLogs', async (request: NextRequest) => {
  const user = await requireRole('teacher')
  const { searchParams } = new URL(request.url)
  const classroomId = searchParams.get('classroom_id')
  const date = searchParams.get('date')

  if (!classroomId) {
    return NextResponse.json(
      { error: 'classroom_id is required' },
      { status: 400 }
    )
  }

  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: 'Invalid date format (use YYYY-MM-DD)' },
      { status: 400 }
    )
  }

  const supabase = getServiceRoleClient()
  const ownership = await assertTeacherOwnsClassroom(user.id, classroomId, { supabase })
  if (!ownership.ok) {
    return NextResponse.json(
      { error: ownership.error },
      { status: ownership.status }
    )
  }

  const rosterResult = await loadClassroomRoster(supabase, classroomId)

  if (rosterResult.enrollmentsError) {
    console.error('Error fetching enrollments:', rosterResult.enrollmentsError)
    return NextResponse.json(
      { error: 'Failed to fetch students' },
      { status: 500 }
    )
  }

  if (rosterResult.profilesError) {
    console.error('Error fetching student profiles:', rosterResult.profilesError)
    return NextResponse.json(
      { error: 'Failed to fetch student profiles' },
      { status: 500 }
    )
  }

  const studentIds = rosterResult.studentIds
  const students = rosterResult.students
  const entriesResult = await loadTeacherLogEntriesForDate(supabase, classroomId, studentIds, date)

  if (entriesResult.error) {
    console.error('Error fetching entries:', entriesResult.error)
    return NextResponse.json(
      { error: 'Failed to fetch entries' },
      { status: 500 }
    )
  }

  const selectedEntries = entriesResult.rows
  const entryByStudentId = new Map(
    selectedEntries.map(entry => [entry.student_id, entry])
  )

  const { entries: historyPreviewEntries, error: historyPreviewError } =
    await fetchHistoryPreviewEntries(supabase, classroomId, studentIds)

  if (historyPreviewError) {
    console.error('Error fetching history preview:', historyPreviewError)
    return NextResponse.json(
      { error: 'Failed to fetch history preview' },
      { status: 500 }
    )
  }

  const historyPreviewByStudentId = new Map<string, Entry[]>()
  for (const entry of (historyPreviewEntries || []) as unknown as Entry[]) {
    const preview = historyPreviewByStudentId.get(entry.student_id) || []
    if (preview.length >= HISTORY_PREVIEW_LIMIT) continue
    preview.push(entry)
    historyPreviewByStudentId.set(entry.student_id, preview)
  }

  const logs = students.map(student => {
    const entry = entryByStudentId.get(student.id) || null
    return {
      student_id: student.id,
      student_email: student.email,
      student_first_name: student.first_name,
      student_last_name: student.last_name,
      entry,
      history_preview: historyPreviewByStudentId.get(student.id) || [],
    }
  })

  return NextResponse.json({
    classroom_id: classroomId,
    date: date || null,
    logs,
  })
})

async function loadTeacherLogEntriesForDate(
  supabase: SupabaseClient,
  classroomId: string,
  studentIds: string[],
  date: string | null,
): Promise<{ rows: Entry[]; error: any }> {
  if (!date || studentIds.length === 0) {
    return { rows: [], error: null }
  }

  return loadChunkedRows<Entry>({
    supabase,
    table: 'entries',
    select: ENTRY_SELECT,
    filters: [
      { column: 'classroom_id', values: [classroomId] },
      { column: 'date', values: [date] },
      { column: 'student_id', values: studentIds },
    ],
    pageSize: TEACHER_LOG_PAGE_SIZE,
    pageOrderColumn: 'id',
  })
}

async function fetchHistoryPreviewEntries(
  supabase: SupabaseClient,
  classroomId: string,
  studentIds: string[]
): Promise<{ entries: Entry[]; error: unknown | null }> {
  if (studentIds.length === 0) {
    return { entries: [], error: null }
  }

  const entries: Entry[] = []
  for (const studentChunk of chunkValues(studentIds, HISTORY_PREVIEW_STUDENT_CHUNK_SIZE)) {
    const { data, error } = await supabase.rpc('get_teacher_log_history_preview', {
      p_classroom_id: classroomId,
      p_student_ids: studentChunk,
      p_limit: HISTORY_PREVIEW_LIMIT,
    })

    if (!error) {
      entries.push(...((data || []) as unknown as Entry[]))
      continue
    }

    if (isMissingRpcError(error)) {
      return fetchHistoryPreviewEntriesFallback(supabase, classroomId, studentIds)
    }

    return { entries: [], error }
  }

  return { entries, error: null }
}

async function fetchHistoryPreviewEntriesFallback(
  supabase: SupabaseClient,
  classroomId: string,
  studentIds: string[],
): Promise<{ entries: Entry[]; error: unknown | null }> {
  console.warn('History preview RPC is unavailable; falling back to per-student preview queries')
  const entries: Entry[] = []

  for (const studentChunk of chunkValues(studentIds, HISTORY_PREVIEW_STUDENT_CHUNK_SIZE)) {
    const results = await Promise.all(
      studentChunk.map((studentId) =>
        supabase
          .from('entries')
          .select(ENTRY_SELECT)
          .eq('classroom_id', classroomId)
          .eq('student_id', studentId)
          .order('date', { ascending: false })
          .order('updated_at', { ascending: false })
          .limit(HISTORY_PREVIEW_LIMIT)
      )
    )

    const failed = results.find(result => result.error)
    if (failed?.error) {
      return { entries: [], error: failed.error }
    }

    entries.push(...results.flatMap(result => (result.data || []) as unknown as Entry[]))
  }

  return {
    entries,
    error: null,
  }
}

function isMissingRpcError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'PGRST202'
  )
}
