import { getServiceRoleClient } from '@/lib/supabase'
import { computeAttendanceRecords } from '@/lib/attendance'
import { getTodayInToronto } from '@/lib/timezone'
import { decryptPassword } from './crypto'
import { planOperations } from './planner'
import { mapDatasetToOperations } from './mapper'
import { normalizeDataset } from './normalizer'
import { validateDataset } from './validator'
import { matchStudents } from './student-matcher'
import {
  buildSyncSummary,
  finalizeSyncJob,
  insertSyncJob,
  insertSyncJobItems,
  loadLatestPayloadHashes,
} from './state-store'
import { launchBrowser, createPage, closeBrowser, resolveFrames } from './playwright/ta-browser'
import { loginToTeachAssist } from './playwright/ta-auth'
import { selectCourse, navigateToAttendance } from './playwright/ta-navigation'
import { readAttendancePage, recordAttendanceForDate } from './playwright/ta-attendance'
import type {
  AttendanceSyncInput,
  AttendanceSyncResult,
  CanonicalAttendanceRecord,
  CanonicalSyncDataset,
  ExecutedOperation,
  PlannedOperation,
  SyncError,
  StudentMatchResult,
  TAAttendanceEntry,
  TAConfig,
  TACredentials,
  TAExecutionMode,
} from './types'

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

/** Load TA configuration for a classroom from teachassist_mappings */
async function loadTAConfig(classroomId: string): Promise<TAConfig> {
  const supabase = getServiceRoleClient()
  const { data, error } = await supabase
    .from('teachassist_mappings')
    .select('config')
    .eq('classroom_id', classroomId)
    .single()

  if (error || !data?.config) {
    throw new Error(
      'TeachAssist configuration not found for this classroom. ' +
      'Please configure TeachAssist settings first.'
    )
  }

  return data.config as TAConfig
}

/** Decrypt credentials from the stored TA config using AES-256-GCM. */
function decryptCredentials(config: TAConfig): TACredentials {
  return {
    username: config.ta_username,
    password: decryptPassword(config.ta_password_encrypted),
    baseUrl: config.ta_base_url,
  }
}

// ---------------------------------------------------------------------------
// Data extraction
// ---------------------------------------------------------------------------

/** Fetch Pika attendance data for a classroom and convert to canonical records */
async function fetchPikaAttendance(
  classroomId: string,
  dateRange?: { from: string; to: string }
): Promise<{ records: CanonicalAttendanceRecord[]; dates: string[] }> {
  const supabase = getServiceRoleClient()
  const today = getTodayInToronto()

  // Fetch class days
  const { data: classDays, error: classDaysError } = await supabase
    .from('class_days')
    .select('*')
    .eq('classroom_id', classroomId)
    .eq('is_class_day', true)
    .order('date', { ascending: true })

  if (classDaysError) {
    throw new Error(`Failed to load class days: ${classDaysError.message}`)
  }

  if (!classDays || classDays.length === 0) {
    return { records: [], dates: [] }
  }

  // Fetch enrolled students with profiles
  const { data: enrollments, error: enrollmentsError } = await supabase
    .from('classroom_enrollments')
    .select('student_id, users!inner(id, email), student_profiles!inner(first_name, last_name)')
    .eq('classroom_id', classroomId)

  if (enrollmentsError) {
    throw new Error(`Failed to load classroom enrollments: ${enrollmentsError.message}`)
  }

  if (!enrollments || enrollments.length === 0) {
    return { records: [], dates: [] }
  }

  // Fetch all entries for this classroom
  const { data: entries, error: entriesError } = await supabase
    .from('entries')
    .select('*')
    .eq('classroom_id', classroomId)

  if (entriesError) {
    throw new Error(`Failed to load attendance entries: ${entriesError.message}`)
  }

  // Build student list in the format computeAttendanceRecords expects
  const students = enrollments.map((e: any) => ({
    id: e.student_id,
    email: e.users?.email || '',
    first_name: e.student_profiles?.first_name || '',
    last_name: e.student_profiles?.last_name || '',
  }))

  // Compute attendance
  const attendanceRecords = computeAttendanceRecords(students, classDays, entries || [], today)

  // Convert to canonical format, filtering to past dates only (no pending)
  const canonicalRecords: CanonicalAttendanceRecord[] = []
  const syncDates = new Set<string>()

  for (const record of attendanceRecords) {
    for (const [date, status] of Object.entries(record.dates)) {
      // Skip pending (today/future)
      if (status === 'pending') continue

      // Apply date range filter if provided
      if (dateRange) {
        if (date < dateRange.from || date > dateRange.to) continue
      }

      canonicalRecords.push({
        entity_key: `${record.student_id}:${date}`,
        student_key: record.student_id,
        date,
        status,
      })

      syncDates.add(date)
    }
  }

  return {
    records: canonicalRecords,
    dates: Array.from(syncDates).sort(),
  }
}

// ---------------------------------------------------------------------------
// Playwright execution
// ---------------------------------------------------------------------------

/** Map Pika status to TeachAssist radio button value */
function pikaStatusToTA(status: 'present' | 'absent'): 'P' | 'A' {
  return status === 'present' ? 'P' : 'A'
}

/** Group planned operations by date */
function groupByDate(planned: PlannedOperation[]): Map<string, PlannedOperation[]> {
  const groups = new Map<string, PlannedOperation[]>()
  for (const op of planned) {
    const date = (op.payload as any).date as string
    if (!date) continue
    const group = groups.get(date) || []
    group.push(op)
    groups.set(date, group)
  }
  return groups
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export async function runAttendanceSync(input: AttendanceSyncInput): Promise<AttendanceSyncResult> {
  const errors: SyncError[] = []
  const unmatchedStudents: StudentMatchResult[] = []

  // Create sync job record
  const job = await insertSyncJob({
    classroomId: input.classroomId,
    mode: input.mode,
    source: 'playwright_attendance',
    sourcePayload: { dateRange: input.dateRange || null },
    createdBy: input.createdBy,
  })

  try {
    if (!input.dateRange) {
      throw new Error('Attendance sync requires a date range')
    }

    if (input.dateRange.from !== input.dateRange.to) {
      throw new Error('Attendance sync only supports a single date per run')
    }

    // -----------------------------------------------------------------------
    // 1. Fetch Pika attendance data
    // -----------------------------------------------------------------------
    const { records, dates } = await fetchPikaAttendance(input.classroomId, input.dateRange)

    if (records.length === 0) {
      const summary = { planned: 0, upserted: 0, skipped: 0, failed: 0 }
      await finalizeSyncJob(job.id, 'completed', summary)
      return { jobId: job.id, ok: true, summary, errors: [], unmatchedStudents: [] }
    }

    // -----------------------------------------------------------------------
    // 2. Run through existing pipeline: normalize → validate → map → plan
    // -----------------------------------------------------------------------
    const dataset: CanonicalSyncDataset = { attendance: records, marks: [], report_cards: [] }
    const normalized = normalizeDataset(dataset)
    const validationErrors = validateDataset(normalized)

    if (validationErrors.length > 0) {
      const summary = { planned: 0, upserted: 0, skipped: 0, failed: 0 }
      await finalizeSyncJob(job.id, 'failed', summary, validationErrors.join('; '))
      return {
        jobId: job.id,
        ok: false,
        summary,
        errors: validationErrors.map((msg) => ({
          type: 'validation' as const,
          message: msg,
          recoverable: false,
        })),
        unmatchedStudents: [],
      }
    }

    const mapped = mapDatasetToOperations(normalized)
    const latestHashes = await loadLatestPayloadHashes(input.classroomId)
    const planned = planOperations(mapped, latestHashes)

    // Separate upserts from noops
    const upserts = planned.filter((op) => op.action === 'upsert')
    const noops = planned.filter((op) => op.action === 'noop')

    // -----------------------------------------------------------------------
    // 3. Dry run: return preview without touching the browser
    // -----------------------------------------------------------------------
    if (input.mode === 'dry_run') {
      const allResults: ExecutedOperation[] = [
        ...upserts.map((op) => ({ ...op, status: 'success' as const, response_payload: { dry_run: true } })),
        ...noops.map((op) => ({ ...op, status: 'skipped' as const })),
      ]
      await insertSyncJobItems(job.id, allResults)
      const summary = buildSyncSummary(allResults)
      await finalizeSyncJob(job.id, 'completed', summary)

      return { jobId: job.id, ok: true, summary, errors: [], unmatchedStudents: [] }
    }

    // -----------------------------------------------------------------------
    // 4. Execute: launch browser, login, fill attendance forms
    // -----------------------------------------------------------------------
    if (upserts.length === 0) {
      // All records are unchanged — nothing to push
      const allResults: ExecutedOperation[] = noops.map((op) => ({ ...op, status: 'skipped' as const }))
      await insertSyncJobItems(job.id, allResults)
      const summary = buildSyncSummary(allResults)
      await finalizeSyncJob(job.id, 'completed', summary)
      return { jobId: job.id, ok: true, summary, errors: [], unmatchedStudents: [] }
    }

    // Load TA config & credentials
    const taConfig = await loadTAConfig(input.classroomId)
    const credentials = decryptCredentials(taConfig)

    // Resolve execution mode: input override > config > default to confirmation
    const executionMode: TAExecutionMode =
      input.executionMode || taConfig.ta_execution_mode || 'confirmation'

    // Launch browser: headed for confirmation (teacher sees it), headless for full_auto
    const browser = await launchBrowser({ headless: executionMode === 'full_auto' })
    const page = await createPage(browser)

    try {
      // Login
      await loginToTeachAssist(page, credentials)

      // Select course & navigate to attendance
      await selectCourse(page, taConfig.ta_course_search)
      const mainFrame = await navigateToAttendance(page)

      // Read TA student list from the page
      const pageState = await readAttendancePage(mainFrame)

      // Fetch Pika student profiles for matching
      const supabase = getServiceRoleClient()
      const { data: enrollments, error: enrollmentLoadError } = await supabase
        .from('classroom_enrollments')
        .select('student_id, student_profiles!inner(first_name, last_name)')
        .eq('classroom_id', input.classroomId)

      if (enrollmentLoadError) {
        throw new Error(`Failed to load enrolled students for matching: ${enrollmentLoadError.message}`)
      }

      const pikaStudents = (enrollments || []).map((e: any) => ({
        student_id: e.student_id,
        first_name: e.student_profiles?.first_name || '',
        last_name: e.student_profiles?.last_name || '',
      }))

      // Match students
      const matchResults = matchStudents(pikaStudents, pageState.students)
      const matchMap = new Map<string, StudentMatchResult>()
      for (const result of matchResults) {
        matchMap.set(result.student_id, result)
        if (!result.matched) {
          unmatchedStudents.push(result)
        }
      }

      // Group upserts by date
      const dateGroups = groupByDate(upserts)
      const executedResults: ExecutedOperation[] = []

      // Process each date
      for (const [date, ops] of dateGroups) {
        const entries: TAAttendanceEntry[] = []
        const opsForDate: Array<{ op: PlannedOperation; matched: boolean }> = []

        for (const op of ops) {
          const studentKey = (op.payload as any).student_key as string
          const status = (op.payload as any).status as 'present' | 'absent'
          const match = matchMap.get(studentKey)

          if (!match || !match.matched || !match.ta_radio_name) {
            // Unmatched student — mark as failed
            executedResults.push({
              ...op,
              status: 'failed',
              error_message: `Student "${match?.pika.first} ${match?.pika.last}" not matched in TeachAssist`,
            })
            opsForDate.push({ op, matched: false })
            continue
          }

          entries.push({
            radioName: match.ta_radio_name,
            status: pikaStatusToTA(status),
          })
          opsForDate.push({ op, matched: true })
        }

        if (entries.length === 0) continue

        try {
          await recordAttendanceForDate(mainFrame, date, entries, executionMode)

          // Mark all matched ops as success
          for (const { op, matched } of opsForDate) {
            if (matched) {
              executedResults.push({ ...op, status: 'success', response_payload: { date, submitted: true } })
            }
          }
        } catch (formError: any) {
          // Form submission failed for this date — mark all ops as failed
          errors.push({
            type: 'form_submission',
            message: formError.message || 'Form submission failed',
            date,
            recoverable: false,
          })
          for (const { op, matched } of opsForDate) {
            if (matched) {
              executedResults.push({
                ...op,
                status: 'failed',
                error_message: formError.message || 'Form submission failed',
              })
            }
          }
        }
      }

      // Add noop results
      const allResults = [
        ...executedResults,
        ...noops.map((op) => ({ ...op, status: 'skipped' as const } as ExecutedOperation)),
      ]

      await insertSyncJobItems(job.id, allResults)
      const summary = buildSyncSummary(allResults)
      const finalStatus = summary.failed > 0 ? 'failed' : 'completed'
      await finalizeSyncJob(job.id, finalStatus, summary, summary.failed > 0 ? 'Some items failed' : undefined)

      return { jobId: job.id, ok: summary.failed === 0, summary, errors, unmatchedStudents }
    } finally {
      await closeBrowser(browser)
    }
  } catch (error: any) {
    const summary = { planned: 0, upserted: 0, skipped: 0, failed: 0 }
    await finalizeSyncJob(job.id, 'failed', summary, error?.message || 'Unexpected sync error')

    return {
      jobId: job.id,
      ok: false,
      summary,
      errors: [
        {
          type: 'browser',
          message: error?.message || 'Unexpected sync error',
          recoverable: false,
        },
      ],
      unmatchedStudents,
    }
  }
}
