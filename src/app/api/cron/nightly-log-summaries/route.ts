import { createHash } from 'node:crypto'
import { summaryRetryDateSchema, summaryRetryClassroomSchema } from '@/lib/validations/nightly-log-summary'
import { withAIRequestDeadline, type AIRequestDeadlineOptions } from '@/lib/ai-request-deadline'
import { NextRequest, NextResponse } from 'next/server'
import { logServerError } from '@/lib/server/diagnostics'
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
  LOG_SUMMARY_POLICY_VERSION,
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
export const maxDuration = 60

const TIMEZONE = 'America/Toronto'
const CONCURRENCY_LIMIT = 5
const JOB_BUDGET_MS = 50_000
const SUMMARY_REQUEST_MS = 20_000
const FEEDBACK_BUDGET_MS = 5_000
const WRITE_RESERVE_MS = 2_000

type PendingFeedback = Parameters<typeof extractAndStoreDeveloperFeedbackCandidates>[1]
type SummaryResult = { generated: boolean; feedback?: PendingFeedback }
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
    logServerError('journal.summary')
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 500 }
    )
  }

  const authHeader = getCronAuthHeader(request)
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const yesterday = formatInTimeZone(subDays(new Date(), 1), TIMEZONE, 'yyyy-MM-dd')
  const requestedDate = request.nextUrl.searchParams.get('date')
  const parsedDate = summaryRetryDateSchema.safeParse(requestedDate ?? yesterday)
  if (!parsedDate.success || parsedDate.data > yesterday) {
    return NextResponse.json({ error: 'Invalid summary date' }, { status: 400 })
  }
  const parsedClassroom = summaryRetryClassroomSchema.safeParse(request.nextUrl.searchParams.get('classroomId') ?? undefined)
  if (!parsedClassroom.success) {
    return NextResponse.json({ error: 'Invalid summary classroom' }, { status: 400 })
  }
  const date = parsedDate.data
  const startedAt = Date.now()
  const remainingMs = () => Math.max(0, JOB_BUDGET_MS - (Date.now() - startedAt))
  let generated = 0
  let skipped = 0
  let failed = 0
  let total: number | null = null
  const pendingClassroomIds = new Set<string>()
  const feedback: PendingFeedback[] = []
  const partialResponse = () => NextResponse.json({
    status: 'partial', generated, skipped, failed,
    remaining: total === null ? null : Math.max(0, total - generated - skipped),
    date, pendingClassroomIds: total === null ? null : [...pendingClassroomIds],
  }, { status: 503, headers: { 'Retry-After': '5' } })

  try {
    return await withAIRequestDeadline(async (signal) => {
      const supabase = createDeadlineClient(signal)
      const { classroomIds: eligibleClassroomIds, error } = await getEligibleClassroomIds(supabase, date)
      signal.throwIfAborted()
      if (error) return error
      const classroomIds = parsedClassroom.data
        ? eligibleClassroomIds.filter((id) => id === parsedClassroom.data)
        : eligibleClassroomIds
      total = classroomIds.length
      for (const classroomId of classroomIds) pendingClassroomIds.add(classroomId)

      // A retry scans the same date and reuses matching persisted results. Finish
      // the required pass before spending any budget on optional feedback.
      for (let i = 0; i < classroomIds.length; i += CONCURRENCY_LIMIT) {
        if (remainingMs() < SUMMARY_REQUEST_MS + WRITE_RESERVE_MS) break
        const batch = classroomIds.slice(i, i + CONCURRENCY_LIMIT)
        await Promise.all(batch.map(async (classroomId) => {
          try {
            const result = await generateSummaryForClassroom(supabase, classroomId, date, {
              signal, timeoutMs: Math.min(SUMMARY_REQUEST_MS, remainingMs() - WRITE_RESERVE_MS),
            })
            signal.throwIfAborted()
            pendingClassroomIds.delete(classroomId)
            if (result.generated) generated++
            else skipped++
            if (result.feedback) feedback.push(result.feedback)
          } catch (error) {
            logServerError('journal.summary', error)
            failed++
          }
        }))
        signal.throwIfAborted()
      }

      const incomplete = generated + skipped < total || failed > 0
      if (!incomplete) {
        for (let i = 0; i < feedback.length; i += CONCURRENCY_LIMIT) {
          if (remainingMs() < FEEDBACK_BUDGET_MS + WRITE_RESERVE_MS) break
          await Promise.all(feedback.slice(i, i + CONCURRENCY_LIMIT).map(async (context) => {
            try {
              const result = await withAIRequestDeadline((feedbackSignal) =>
                extractAndStoreDeveloperFeedbackCandidates(createDeadlineClient(feedbackSignal), context, {
                  signal: feedbackSignal, timeoutMs: FEEDBACK_BUDGET_MS,
                }), { signal, timeoutMs: FEEDBACK_BUDGET_MS })
              if (result.tableMissing) {
                console.warn('Developer feedback candidates table is not available; skipping extraction storage.')
              }
            } catch (error) {
              logServerError('journal.feedback', error)
            }
          }))
        }
      }
      signal.throwIfAborted()
      return incomplete ? partialResponse() : NextResponse.json({ status: 'ok', generated, skipped })
    }, { timeoutMs: JOB_BUDGET_MS })
  } catch (error) {
    logServerError('journal.summary', error)
    return partialResponse()
  }
}

function createDeadlineClient(signal: AbortSignal): SupabaseClient {
  return getServiceRoleClient({
    fetch: (input, init) => {
      signal.throwIfAborted()
      const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
      return fetch(input, {
        ...init,
        signal: requestSignal ? AbortSignal.any([signal, requestSignal]) : signal,
      })
    },
  })
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
    logServerError('journal.query', activeEntriesResult.error)
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
    logServerError('journal.query', classDaysResult.error)
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
  date: string,
  options: AIRequestDeadlineOptions,
): Promise<SummaryResult> {
  options.signal?.throwIfAborted()
  const eligible = await isClassroomEligibleForSummary(supabase, classroomId, date)
  if (!eligible) {
    return { generated: false }
  }

  const enrollmentsResult = await loadEnrollmentStudentRows(supabase, classroomId)

  if (enrollmentsResult.error) {
    logServerError('journal.query', enrollmentsResult.error)
    throw enrollmentsResult.error
  }

  const rosterStudentIds = [...new Set(enrollmentsResult.rows.map((row) => row.student_id))]
  if (rosterStudentIds.length === 0) {
    return { generated: false }
  }

  const entriesResult = await loadSummaryEntriesForClassroom(supabase, classroomId, rosterStudentIds, date)

  if (entriesResult.error) {
    logServerError('journal.query', entriesResult.error)
    throw entriesResult.error
  }

  const entries = entriesResult.rows
  if (entries.length === 0) {
    return { generated: false }
  }

  const entryStudentIds = [...new Set(entries.map((e) => e.student_id))]
  const studentIdsForRedaction = [...new Set([...entryStudentIds, ...rosterStudentIds])]

  const rosterRowsResult = await loadRosterNameRows(supabase, classroomId)

  if (rosterRowsResult.error) {
    logServerError('journal.query', rosterRowsResult.error)
    throw rosterRowsResult.error
  }

  const profilesResult = await loadStudentProfileRows(supabase, studentIdsForRedaction)
  if (profilesResult.error) {
    logServerError('journal.query', profilesResult.error)
    throw profilesResult.error
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
    return { generated: false }
  }

  const { system, user, sourceMap } = buildSummaryPrompt(date, sanitizedLogs)
  const model = getSummaryModel()
  const inputDigest = createHash('sha256').update(JSON.stringify({
    system, user, sourceMap, initialsMap, model, policy: LOG_SUMMARY_POLICY_VERSION,
    entries: entries.map((entry) => [entry.id, entry.updated_at]),
  })).digest('hex')
  const { data: existing, error: existingError } = await supabase.from('log_summaries')
    .select('summary_items').eq('classroom_id', classroomId).eq('date', date).maybeSingle()
  if (existingError) throw existingError
  const existingItems = existing?.summary_items
  if (existingItems && typeof existingItems === 'object' && !Array.isArray(existingItems)
    && existingItems.input_digest === inputDigest) {
    return { generated: false }
  }
  options.signal?.throwIfAborted()
  const rawResponse = await withAIRequestDeadline((signal) =>
    callOpenAIForSummary(system, user, sourceMap, { ...options, signal }), options)
  options.signal?.throwIfAborted()

  const summaryItemsForStorage = {
    policy_version: LOG_SUMMARY_POLICY_VERSION,
    input_digest: inputDigest,
    overview: rawResponse.overview,
    action_items: rawResponse.action_items.map((item) => ({
      text: item.text,
      initials: item.initials,
    })),
  }

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
    throw upsertError
  }

  return {
    generated: true,
    feedback: {
      classroomId, date, sourceEntryCount: entries.length,
      model: getDeveloperFeedbackModel(), sanitizedLogs,
    },
  }
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

  if (classroomError && classroomError.code !== 'PGRST116') throw classroomError
  if (!classroom) {
    return false
  }

  const { data: classDay, error: classDayError } = await supabase
    .from('class_days')
    .select('id')
    .eq('classroom_id', classroomId)
    .eq('date', date)
    .eq('is_class_day', true)
    .single()

  if (classDayError && classDayError.code !== 'PGRST116') throw classDayError
  return !!classDay
}

export const GET = withErrorHandler('GetCronNightlyLogSummaries', async (request: NextRequest) => {
  return handle(request)
})

export const POST = withErrorHandler('PostCronNightlyLogSummaries', async (request: NextRequest) => {
  return handle(request)
})
