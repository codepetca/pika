import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import type { Entry } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const HISTORY_PREVIEW_LIMIT = 5
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

  const { data: classroom, error: classroomError } = await supabase
    .from('classrooms')
    .select('teacher_id')
    .eq('id', classroomId)
    .single()

  if (classroomError || !classroom) {
    return NextResponse.json(
      { error: 'Classroom not found' },
      { status: 404 }
    )
  }

  if (classroom.teacher_id !== user.id) {
    return NextResponse.json(
      { error: 'Forbidden' },
      { status: 403 }
    )
  }

  const { data: enrollments, error: enrollmentsError } = await supabase
    .from('classroom_enrollments')
    .select(`
      student_id,
      users!classroom_enrollments_student_id_fkey(
        id,
        email
      )
    `)
    .eq('classroom_id', classroomId)

  if (enrollmentsError) {
    console.error('Error fetching enrollments:', enrollmentsError)
    return NextResponse.json(
      { error: 'Failed to fetch students' },
      { status: 500 }
    )
  }

  const studentIds = (enrollments || []).map(e => e.student_id)
  const { data: profiles, error: profilesError } = studentIds.length > 0
    ? await supabase
      .from('student_profiles')
      .select('user_id, first_name, last_name')
      .in('user_id', studentIds)
    : { data: [], error: null }

  if (profilesError) {
    console.error('Error fetching student profiles:', profilesError)
  }

  const profileMap = new Map(
    (profiles || []).map(p => [p.user_id, p])
  )

  const students = (enrollments || [])
    .map(e => {
      const u = e.users as unknown as { id: string; email: string }
      const profile = profileMap.get(u.id)
      return {
        id: u.id,
        email: u.email,
        first_name: profile?.first_name || '',
        last_name: profile?.last_name || '',
      }
    })
    .sort((a, b) => a.email.localeCompare(b.email))

  const { data: entries, error: entriesError } = date
    ? await supabase
      .from('entries')
      .select(ENTRY_SELECT)
      .eq('classroom_id', classroomId)
      .eq('date', date)
    : { data: [], error: null }

  if (entriesError) {
    console.error('Error fetching entries:', entriesError)
    return NextResponse.json(
      { error: 'Failed to fetch entries' },
      { status: 500 }
    )
  }

  const selectedEntries = (entries || []) as unknown as Entry[]
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

async function fetchHistoryPreviewEntries(
  supabase: SupabaseClient,
  classroomId: string,
  studentIds: string[]
): Promise<{ entries: Entry[]; error: unknown | null }> {
  if (studentIds.length === 0) {
    return { entries: [], error: null }
  }

  const { data, error } = await supabase.rpc('get_teacher_log_history_preview', {
    p_classroom_id: classroomId,
    p_student_ids: studentIds,
    p_limit: HISTORY_PREVIEW_LIMIT,
  })

  if (!error) {
    return { entries: (data || []) as unknown as Entry[], error: null }
  }

  if (!isMissingRpcError(error)) {
    return { entries: [], error }
  }

  console.warn('History preview RPC is unavailable; falling back to per-student preview queries')
  const results = await Promise.all(
    studentIds.map((studentId) =>
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

  return {
    entries: results.flatMap(result => (result.data || []) as unknown as Entry[]),
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
