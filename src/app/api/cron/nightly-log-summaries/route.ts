import { NextRequest, NextResponse } from 'next/server'
import { formatInTimeZone } from 'date-fns-tz'
import { subDays } from 'date-fns'
import { getServiceRoleClient } from '@/lib/supabase'
import { extractPlainText, isValidTiptapContent } from '@/lib/tiptap-content'
import {
  buildInitialsMap,
  sanitizeEntryText,
  buildSummaryPrompt,
  callOpenAIForSummary,
  getSummaryModel,
} from '@/lib/log-summary'
import {
  extractAndStoreDeveloperFeedbackCandidates,
  getDeveloperFeedbackModel,
} from '@/lib/developer-log-feedback'
import type { TiptapContent } from '@/types'
import { withErrorHandler } from '@/lib/api-handler'
import {
  chunkValues,
  loadChunkedRows,
  loadPagedRows,
} from '@/lib/server/query-chunks'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const TIMEZONE = 'America/Toronto'
const CONCURRENCY_LIMIT = 5
const CRON_READ_PAGE_SIZE = 1000
const CRON_FILTER_CHUNK_SIZE = 50

type SupabaseClient = ReturnType<typeof getServiceRoleClient>
type ActiveClassroomEntryRow = { classroom_id: string }
type ClassDayClassroomRow = { classroom_id: string }
type SummaryEntryRow = {
  id: string
  classroom_id: string
  student_id: string
  text: string | null
  rich_content: unknown
  updated_at: string | null
}
type EnrollmentStudentRow = { student_id: string }
type ClassroomRosterNameRow = { first_name: string | null; last_name: string | null }
type StudentProfileRow = {
  user_id: string
  first_name: string | null
  last_name: string | null
}

function getCronAuthHeader(request: NextRequest): string | null {
  return request.headers.get('authorization') ?? request.headers.get('Authorization')
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

  const supabase = getServiceRoleClient()
  const yesterday = formatInTimeZone(
    subDays(new Date(), 1),
    TIMEZONE,
    'yyyy-MM-dd'
  )

  const { classroomIds, error: eligibleClassroomsError } =
    await getEligibleClassroomIds(supabase, yesterday)

  if (eligibleClassroomsError) {
    return eligibleClassroomsError
  }

  if (classroomIds.length === 0) {
    return NextResponse.json({ status: 'ok', generated: 0, skipped: 0 })
  }

  let generated = 0
  let skipped = 0

  // Process classrooms with concurrency limit
  for (let i = 0; i < classroomIds.length; i += CONCURRENCY_LIMIT) {
    const batch = classroomIds.slice(i, i + CONCURRENCY_LIMIT)
    const results = await Promise.allSettled(
      batch.map((classroomId) =>
        generateSummaryForClassroom(supabase, classroomId, yesterday)
      )
    )

    for (const result of results) {
      if (result.status === 'fulfilled') {
        if (result.value) {
          generated++
        } else {
          skipped++
        }
      } else {
        console.error('Error generating summary:', result.reason)
        skipped++
      }
    }
  }

  return NextResponse.json({ status: 'ok', generated, skipped })
}

async function getEligibleClassroomIds(
  supabase: SupabaseClient,
  date: string
): Promise<{ classroomIds: string[]; error: NextResponse | null }> {
  const activeEntriesResult = await loadPagedRows<ActiveClassroomEntryRow>(() =>
    supabase
      .from('entries')
      .select('classroom_id, classrooms!inner(archived_at,start_date,end_date)')
      .eq('date', date)
      .is('classrooms.archived_at', null)
      .lte('classrooms.start_date', date)
      .gte('classrooms.end_date', date),
    CRON_READ_PAGE_SIZE,
    'id',
  )

  if (activeEntriesResult.error) {
    console.error('Error fetching active classrooms:', activeEntriesResult.error)
    return {
      classroomIds: [],
      error: NextResponse.json(
        { error: 'Failed to fetch entries' },
        { status: 500 }
      ),
    }
  }

  const classroomIds = [...new Set(activeEntriesResult.rows.map((e) => e.classroom_id))]
  if (classroomIds.length === 0) {
    return { classroomIds: [], error: null }
  }

  const classDaysResult = await loadClassDayRowsForClassrooms(supabase, classroomIds, date)

  if (classDaysResult.error) {
    console.error('Error fetching class days:', classDaysResult.error)
    return {
      classroomIds: [],
      error: NextResponse.json(
        { error: 'Failed to fetch class days' },
        { status: 500 }
      ),
    }
  }

  const classDayIds = new Set(classDaysResult.rows.map((day) => day.classroom_id))
  return {
    classroomIds: classroomIds.filter((classroomId) => classDayIds.has(classroomId)),
    error: null,
  }
}

async function generateSummaryForClassroom(
  supabase: SupabaseClient,
  classroomId: string,
  date: string
): Promise<boolean> {
  const eligible = await isClassroomEligibleForSummary(supabase, classroomId, date)
  if (!eligible) {
    return false
  }

  const enrollmentsResult = await loadEnrollmentStudentRows(supabase, classroomId)

  if (enrollmentsResult.error) {
    console.error(`Error fetching roster for classroom ${classroomId}:`, enrollmentsResult.error)
    return false
  }

  const rosterStudentIds = [...new Set(enrollmentsResult.rows.map((row) => row.student_id))]
  if (rosterStudentIds.length === 0) {
    return false
  }

  const entriesResult = await loadSummaryEntriesForClassroom(supabase, classroomId, rosterStudentIds, date)

  if (entriesResult.error) {
    console.error(`Error fetching entries for classroom ${classroomId}:`, entriesResult.error)
    return false
  }

  const entries = entriesResult.rows
  if (entries.length === 0) {
    return false
  }

  const entryStudentIds = [...new Set(entries.map((e) => e.student_id))]
  const studentIdsForRedaction = [...new Set([...entryStudentIds, ...rosterStudentIds])]

  const rosterRowsResult = await loadRosterNameRows(supabase, classroomId)

  if (rosterRowsResult.error) {
    console.error(`Error fetching roster names for classroom ${classroomId}:`, rosterRowsResult.error)
    return false
  }

  const profilesResult = await loadStudentProfileRows(supabase, studentIdsForRedaction)
  if (profilesResult.error) {
    console.error(`Error fetching student profiles for classroom ${classroomId}:`, profilesResult.error)
    return false
  }

  const profileMap = new Map(
    profilesResult.rows.map((p) => [p.user_id, p])
  )

  const studentsByName = new Map<string, { firstName: string; lastName: string }>()
  function addStudentForRedaction(firstName?: string | null, lastName?: string | null) {
    const student = {
      firstName: firstName || '',
      lastName: lastName || '',
    }
    const key = `${student.firstName} ${student.lastName}`.trim().toLowerCase()
    if (!key) return
    if (!studentsByName.has(key)) studentsByName.set(key, student)
  }

  for (const studentId of studentIdsForRedaction) {
    const profile = profileMap.get(studentId)
    addStudentForRedaction(profile?.first_name, profile?.last_name)
  }

  for (const row of rosterRowsResult.rows) {
    addStudentForRedaction(row.first_name, row.last_name)
  }

  const students = [...studentsByName.values()]

  const initialsMap = buildInitialsMap(students)

  const nameToInitials: Record<string, string> = {}
  for (const [initials, fullName] of Object.entries(initialsMap)) {
    nameToInitials[fullName] = initials
  }

  const sanitizedLogs: { initials: string; text: string }[] = []
  for (const entry of entries) {
    const profile = profileMap.get(entry.student_id)
    const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ')
    const initials = nameToInitials[fullName] || '?'

    let text = ''
    if (entry.rich_content && isValidTiptapContent(entry.rich_content)) {
      text = extractPlainText(entry.rich_content as TiptapContent)
    }
    if (!text.trim() && entry.text) {
      text = entry.text
    }

    if (!text.trim()) continue

    const sanitized = sanitizeEntryText(text, students, initialsMap)
    sanitizedLogs.push({ initials, text: sanitized })
  }

  if (sanitizedLogs.length === 0) {
    return false
  }

  const { system, user } = buildSummaryPrompt(date, sanitizedLogs)
  const rawResponse = await callOpenAIForSummary(system, user)

  const summaryItemsForStorage = {
    overview: rawResponse.overview,
    action_items: rawResponse.action_items.map((item) => ({
      text: item.text,
      initials: item.initials,
    })),
  }

  const model = getSummaryModel()

  // Get max updated_at from entries for staleness tracking
  const maxUpdatedAt = entries.reduce<string | null>((max, e) => {
    if (!e.updated_at) return max
    return !max || e.updated_at > max ? e.updated_at : max
  }, null)

  const { error: upsertError } = await supabase.from('log_summaries').upsert(
    {
      classroom_id: classroomId,
      date,
      summary_items: summaryItemsForStorage,
      initials_map: initialsMap,
      entry_count: entries.length,
      entries_updated_at: maxUpdatedAt,
      model,
      generated_at: new Date().toISOString(),
    },
    { onConflict: 'classroom_id,date' }
  )

  if (upsertError) {
    console.error(`Error upserting summary for classroom ${classroomId}:`, upsertError)
    return false
  }

  try {
    const developerFeedbackResult = await extractAndStoreDeveloperFeedbackCandidates(supabase, {
      classroomId,
      date,
      sourceEntryCount: entries.length,
      model: getDeveloperFeedbackModel(),
      sanitizedLogs,
    })

    if (developerFeedbackResult.tableMissing) {
      console.warn('Developer feedback candidates table is not available; skipping extraction storage.')
    }
  } catch (error) {
    console.error(`Error extracting developer feedback for classroom ${classroomId}:`, error)
  }

  return true
}

async function loadClassDayRowsForClassrooms(
  supabase: SupabaseClient,
  classroomIds: string[],
  date: string,
): Promise<{ rows: ClassDayClassroomRow[]; error: any }> {
  if (classroomIds.length === 0) {
    return { rows: [], error: null }
  }

  const rows: ClassDayClassroomRow[] = []
  for (const classroomIdChunk of chunkValues(classroomIds, CRON_FILTER_CHUNK_SIZE)) {
    const result = await loadPagedRows<ClassDayClassroomRow>(() =>
      supabase
        .from('class_days')
        .select('classroom_id')
        .in('classroom_id', classroomIdChunk)
        .eq('date', date)
        .eq('is_class_day', true),
      CRON_READ_PAGE_SIZE,
      'classroom_id',
    )

    if (result.error) {
      return { rows: [], error: result.error }
    }

    rows.push(...result.rows)
  }

  return { rows, error: null }
}

async function loadSummaryEntriesForClassroom(
  supabase: SupabaseClient,
  classroomId: string,
  studentIds: string[],
  date: string,
): Promise<{ rows: SummaryEntryRow[]; error: any }> {
  if (studentIds.length === 0) {
    return { rows: [], error: null }
  }

  const rows: SummaryEntryRow[] = []
  for (const studentIdChunk of chunkValues(studentIds, CRON_FILTER_CHUNK_SIZE)) {
    const result = await loadPagedRows<SummaryEntryRow>(() =>
      supabase
        .from('entries')
        .select('*, classrooms!inner(archived_at,start_date,end_date)')
        .eq('classroom_id', classroomId)
        .eq('date', date)
        .in('student_id', studentIdChunk)
        .is('classrooms.archived_at', null)
        .lte('classrooms.start_date', date)
        .gte('classrooms.end_date', date),
      CRON_READ_PAGE_SIZE,
      'id',
    )

    if (result.error) {
      return { rows: [], error: result.error }
    }

    rows.push(...result.rows)
  }

  return { rows, error: null }
}

async function loadEnrollmentStudentRows(
  supabase: SupabaseClient,
  classroomId: string,
): Promise<{ rows: EnrollmentStudentRow[]; error: any }> {
  return loadPagedRows<EnrollmentStudentRow>(() =>
    supabase
      .from('classroom_enrollments')
      .select('student_id')
      .eq('classroom_id', classroomId),
    CRON_READ_PAGE_SIZE,
    'id',
  )
}

async function loadRosterNameRows(
  supabase: SupabaseClient,
  classroomId: string,
): Promise<{ rows: ClassroomRosterNameRow[]; error: any }> {
  return loadPagedRows<ClassroomRosterNameRow>(() =>
    supabase
      .from('classroom_roster')
      .select('first_name, last_name')
      .eq('classroom_id', classroomId),
    CRON_READ_PAGE_SIZE,
    'id',
  )
}

async function loadStudentProfileRows(
  supabase: SupabaseClient,
  studentIds: string[],
): Promise<{ rows: StudentProfileRow[]; error: any }> {
  if (studentIds.length === 0) {
    return { rows: [], error: null }
  }

  return loadChunkedRows<StudentProfileRow>({
    supabase,
    table: 'student_profiles',
    select: 'user_id, first_name, last_name',
    filters: [{ column: 'user_id', values: studentIds }],
    chunkSize: CRON_FILTER_CHUNK_SIZE,
    pageSize: CRON_READ_PAGE_SIZE,
    pageOrderColumn: 'id',
  })
}

async function isClassroomEligibleForSummary(
  supabase: SupabaseClient,
  classroomId: string,
  date: string
): Promise<boolean> {
  const { data: classroom, error: classroomError } = await supabase
    .from('classrooms')
    .select('id')
    .eq('id', classroomId)
    .is('archived_at', null)
    .lte('start_date', date)
    .gte('end_date', date)
    .single()

  if (classroomError || !classroom) {
    return false
  }

  const { data: classDay, error: classDayError } = await supabase
    .from('class_days')
    .select('id')
    .eq('classroom_id', classroomId)
    .eq('date', date)
    .eq('is_class_day', true)
    .single()

  return !classDayError && !!classDay
}

export const GET = withErrorHandler('GetCronNightlyLogSummaries', async (request: NextRequest) => {
  return handle(request)
})

export const POST = withErrorHandler('PostCronNightlyLogSummaries', async (request: NextRequest) => {
  return handle(request)
})
