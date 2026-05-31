import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { getTodayInToronto } from '@/lib/timezone'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'
import { hasMeaningfulTestResponse } from '@/lib/test-responses'
import { isAssignmentVisibleToStudents } from '@/lib/server/assignments'
import { withErrorHandler } from '@/lib/api-handler'
import { chunkValues, loadPagedRows } from '@/lib/server/query-chunks'
import {
  getEffectiveStudentTestAccess,
  isMissingTestAttemptClosureColumnsError,
  isMissingTestStudentAvailabilityError,
} from '@/lib/server/tests'

export const dynamic = 'force-dynamic'
export const revalidate = 0
const STUDENT_NOTIFICATIONS_PAGE_SIZE = 1000

type AssignmentNotificationRow = {
  id: string
  released_at: string | null
}

type AssignmentDocNotificationRow = {
  assignment_id: string
  viewed_at: string | null
  returned_at: string | null
  feedback_returned_at: string | null
}

type TestNotificationRow = {
  id: string
  status: string
}

type TestResponseNotificationRow = {
  test_id: string
  selected_option: unknown
  response_text: unknown
}

type TestAttemptNotificationRow = {
  test_id: string
  is_submitted: boolean
  closed_for_grading_at: string | null
}

type LegacyTestAttemptNotificationRow = {
  test_id: string
  is_submitted: boolean
}

type TestAvailabilityNotificationRow = {
  test_id: string
  state: unknown
}

type AnnouncementNotificationRow = {
  id: string
}

type AnnouncementReadNotificationRow = {
  announcement_id: string
}

function parseTimestamp(value: string | null | undefined) {
  if (!value) return null
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

function hasUnreadAssignmentDocNotification(doc: AssignmentDocNotificationRow | undefined) {
  if (!doc) return true
  const viewedTime = parseTimestamp(doc.viewed_at)
  if (viewedTime === null) return true

  const latestReturnTime = Math.max(
    parseTimestamp(doc.returned_at) ?? 0,
    parseTimestamp(doc.feedback_returned_at) ?? 0
  )

  return latestReturnTime > viewedTime
}

async function loadVisibleAssignmentIds(
  supabase: any,
  classroomId: string
): Promise<{ ids: string[]; error: any }> {
  const { rows, error } = await loadPagedRows<AssignmentNotificationRow>(() =>
    supabase
      .from('assignments')
      .select('id,released_at')
      .eq('classroom_id', classroomId)
      .eq('is_draft', false),
    STUDENT_NOTIFICATIONS_PAGE_SIZE
  )

  if (error) return { ids: [], error }

  const ids = rows
    .filter((assignment) =>
      isAssignmentVisibleToStudents({ is_draft: false, released_at: assignment.released_at ?? null })
    )
    .map((assignment) => assignment.id)

  return { ids, error: null }
}

async function loadAssignmentDocsForAssignments(
  supabase: any,
  studentId: string,
  assignmentIds: string[]
): Promise<{ rows: AssignmentDocNotificationRow[]; error: any }> {
  if (assignmentIds.length === 0) return { rows: [], error: null }

  const rows: AssignmentDocNotificationRow[] = []
  for (const assignmentIdChunk of chunkValues(assignmentIds)) {
    const result = await loadPagedRows<AssignmentDocNotificationRow>(() =>
      supabase
        .from('assignment_docs')
        .select('assignment_id, viewed_at, returned_at, feedback_returned_at')
        .eq('student_id', studentId)
        .in('assignment_id', assignmentIdChunk),
      STUDENT_NOTIFICATIONS_PAGE_SIZE
    )

    if (result.error) return result
    rows.push(...result.rows)
  }

  return { rows, error: null }
}

async function loadTestNotificationCandidates(
  supabase: any,
  classroomId: string
): Promise<{ rows: TestNotificationRow[]; error: any }> {
  return loadPagedRows<TestNotificationRow>(() =>
    supabase
      .from('tests')
      .select('id, status')
      .eq('classroom_id', classroomId)
      .in('status', ['active', 'closed']),
    STUDENT_NOTIFICATIONS_PAGE_SIZE
  )
}

async function loadTestResponsesForTests(
  supabase: any,
  studentId: string,
  testIds: string[]
): Promise<{ rows: TestResponseNotificationRow[]; error: any }> {
  if (testIds.length === 0) return { rows: [], error: null }

  const rows: TestResponseNotificationRow[] = []
  for (const testIdChunk of chunkValues(testIds)) {
    const result = await loadPagedRows<TestResponseNotificationRow>(() =>
      supabase
        .from('test_responses')
        .select('test_id, selected_option, response_text')
        .eq('student_id', studentId)
        .in('test_id', testIdChunk),
      STUDENT_NOTIFICATIONS_PAGE_SIZE
    )

    if (result.error) return result
    rows.push(...result.rows)
  }

  return { rows, error: null }
}

async function loadTestAttemptsForTests(
  supabase: any,
  studentId: string,
  testIds: string[]
): Promise<{ rows: TestAttemptNotificationRow[]; error: any }> {
  if (testIds.length === 0) return { rows: [], error: null }

  const rows: TestAttemptNotificationRow[] = []
  for (const testIdChunk of chunkValues(testIds)) {
    const result = await loadPagedRows<TestAttemptNotificationRow>(() =>
      supabase
        .from('test_attempts')
        .select('test_id, is_submitted, closed_for_grading_at')
        .eq('student_id', studentId)
        .in('test_id', testIdChunk),
      STUDENT_NOTIFICATIONS_PAGE_SIZE
    )

    if (result.error) return result
    rows.push(...result.rows)
  }

  return { rows, error: null }
}

async function loadLegacyTestAttemptsForTests(
  supabase: any,
  studentId: string,
  testIds: string[]
): Promise<{ rows: TestAttemptNotificationRow[]; error: any }> {
  if (testIds.length === 0) return { rows: [], error: null }

  const rows: TestAttemptNotificationRow[] = []
  for (const testIdChunk of chunkValues(testIds)) {
    const result = await loadPagedRows<LegacyTestAttemptNotificationRow>(() =>
      supabase
        .from('test_attempts')
        .select('test_id, is_submitted')
        .eq('student_id', studentId)
        .in('test_id', testIdChunk),
      STUDENT_NOTIFICATIONS_PAGE_SIZE
    )

    if (result.error) return { rows: [], error: result.error }
    rows.push(...result.rows.map((attempt) => ({
      ...attempt,
      closed_for_grading_at: null,
    })))
  }

  return { rows, error: null }
}

async function loadTestAvailabilityForTests(
  supabase: any,
  studentId: string,
  testIds: string[]
): Promise<{ rows: TestAvailabilityNotificationRow[]; error: any }> {
  if (testIds.length === 0) return { rows: [], error: null }

  const rows: TestAvailabilityNotificationRow[] = []
  for (const testIdChunk of chunkValues(testIds)) {
    const result = await loadPagedRows<TestAvailabilityNotificationRow>(() =>
      supabase
        .from('test_student_availability')
        .select('test_id, state')
        .eq('student_id', studentId)
        .in('test_id', testIdChunk),
      STUDENT_NOTIFICATIONS_PAGE_SIZE
    )

    if (result.error) return result
    rows.push(...result.rows)
  }

  return { rows, error: null }
}

async function loadAnnouncementIds(
  supabase: any,
  classroomId: string
): Promise<{ ids: string[]; error: any }> {
  const { rows, error } = await loadPagedRows<AnnouncementNotificationRow>(() =>
    supabase
      .from('announcements')
      .select('id')
      .eq('classroom_id', classroomId)
      .or('scheduled_for.is.null,scheduled_for.lte.now()'),
    STUDENT_NOTIFICATIONS_PAGE_SIZE
  )

  if (error) return { ids: [], error }
  return { ids: rows.map((announcement) => announcement.id), error: null }
}

async function loadAnnouncementReadsForAnnouncements(
  supabase: any,
  userId: string,
  announcementIds: string[]
): Promise<{ rows: AnnouncementReadNotificationRow[]; error: any }> {
  if (announcementIds.length === 0) return { rows: [], error: null }

  const rows: AnnouncementReadNotificationRow[] = []
  for (const announcementIdChunk of chunkValues(announcementIds)) {
    const result = await loadPagedRows<AnnouncementReadNotificationRow>(() =>
      supabase
        .from('announcement_reads')
        .select('announcement_id')
        .eq('user_id', userId)
        .in('announcement_id', announcementIdChunk),
      STUDENT_NOTIFICATIONS_PAGE_SIZE
    )

    if (result.error) return result
    rows.push(...result.rows)
  }

  return { rows, error: null }
}

/**
 * GET /api/student/notifications?classroom_id=xxx
 * Returns notification state for the student sidebar:
 * - hasTodayEntry: whether student has saved any content for today
 * - unviewedAssignmentsCount: count of assignments not yet viewed
 */
export const GET = withErrorHandler('GetStudentNotifications', async (request, context) => {
  const user = await requireRole('student')
  const { searchParams } = new URL(request.url)
  const classroomId = searchParams.get('classroom_id')

  if (!classroomId) {
    return NextResponse.json(
      { error: 'classroom_id is required' },
      { status: 400 }
    )
  }
  const scopedClassroomId = classroomId

  const supabase = getServiceRoleClient()

  const access = await assertStudentCanAccessClassroom(user.id, scopedClassroomId)
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status }
    )
  }

  const today = getTodayInToronto()

  // Check if today is a class day
  const { data: classDay, error: classDayError } = await supabase
    .from('class_days')
    .select('is_class_day')
    .eq('classroom_id', scopedClassroomId)
    .eq('date', today)
    .maybeSingle()

  if (classDayError) {
    console.error('Error checking class day:', classDayError)
    return NextResponse.json(
      { error: 'Failed to check notifications' },
      { status: 500 }
    )
  }

  // If today is not a class day, no need to check for entry
  const isClassDay = classDay?.is_class_day === true
  let hasTodayEntry = true // Default to true (no pulse) if not a class day

  if (isClassDay) {
    // Check if entry exists for today
    const { data: todayEntry, error: entryError } = await supabase
      .from('entries')
      .select('id')
      .eq('student_id', user.id)
      .eq('classroom_id', scopedClassroomId)
      .eq('date', today)
      .maybeSingle()

    if (entryError) {
      console.error('Error checking today entry:', entryError)
      return NextResponse.json(
        { error: 'Failed to check notifications' },
        { status: 500 }
      )
    }

    hasTodayEntry = todayEntry !== null
  }

  const { ids: assignmentIds, error: assignmentsError } = await loadVisibleAssignmentIds(
    supabase,
    scopedClassroomId
  )

  if (assignmentsError) {
    console.error('Error fetching assignments:', assignmentsError)
    return NextResponse.json(
      { error: 'Failed to check notifications' },
      { status: 500 }
    )
  }

  // Count unviewed assignments
  let unviewedCount = 0

  if (assignmentIds.length > 0) {
    const { rows: docs, error: docsError } = await loadAssignmentDocsForAssignments(
      supabase,
      user.id,
      assignmentIds
    )

    if (docsError) {
      console.error('Error fetching assignment docs:', docsError)
      return NextResponse.json(
        { error: 'Failed to check notifications' },
        { status: 500 }
      )
    }

    // Build map of assignment_id -> doc
    const docMap = new Map(docs?.map((d) => [d.assignment_id, d]) || [])

    // Count: no doc exists OR doc.viewed_at is null
    for (const assignmentId of assignmentIds) {
      const doc = docMap.get(assignmentId)
      if (hasUnreadAssignmentDocNotification(doc)) {
        unviewedCount++
      }
    }
  }

  async function countActiveUnansweredTests(
    opts?: { tolerateMissingTable?: boolean }
  ): Promise<{ count: number; error: boolean }> {
    const tolerateMissingTable = opts?.tolerateMissingTable === true

    const { rows: testRows, error: testRowsError } = await loadTestNotificationCandidates(
      supabase,
      scopedClassroomId
    )

    if (testRowsError) {
      if (tolerateMissingTable && testRowsError.code === 'PGRST205') {
        return { count: 0, error: false }
      }
      console.error('Error fetching tests:', testRowsError)
      return { count: 0, error: true }
    }

    const testIds = (testRows || []).map((row) => row.id)

    if (testIds.length === 0) {
      return { count: 0, error: false }
    }

    const {
      rows: responses,
      error: responsesError,
    } = await loadTestResponsesForTests(supabase, user.id, testIds)

    if (responsesError) {
      if (tolerateMissingTable && responsesError.code === 'PGRST205') {
        return { count: 0, error: false }
      }
      console.error('Error fetching test responses:', responsesError)
      return { count: 0, error: true }
    }

    const respondedIds = new Set<string>()
    for (const row of responses || []) {
      if (!hasMeaningfulTestResponse(row)) continue
      respondedIds.add(row.test_id)
    }

    type AttemptRow = {
      test_id: string
      is_submitted: boolean
      closed_for_grading_at: string | null
    }
    let submittedAttempts: AttemptRow[] | null = null
    let attemptsError: { code?: string; message?: string; details?: string | null; hint?: string | null } | null = null

    {
      const latestAttemptsResult = await loadTestAttemptsForTests(supabase, user.id, testIds)
      submittedAttempts = latestAttemptsResult.rows
      attemptsError = latestAttemptsResult.error
    }

    if (attemptsError && isMissingTestAttemptClosureColumnsError(attemptsError)) {
      const legacyAttemptsResult = await loadLegacyTestAttemptsForTests(supabase, user.id, testIds)
      submittedAttempts = legacyAttemptsResult.rows
      attemptsError = legacyAttemptsResult.error
    }

    if (attemptsError && attemptsError.code !== 'PGRST205') {
      console.error('Error fetching test_attempts:', attemptsError)
      return { count: 0, error: true }
    }

    const lockedForGradingIds = new Set<string>()
    for (const attempt of submittedAttempts || []) {
      if (attempt.is_submitted && attempt.test_id) {
        respondedIds.add(attempt.test_id)
      }
      if (attempt.closed_for_grading_at && attempt.test_id) {
        lockedForGradingIds.add(attempt.test_id)
      }
    }

    const availabilityByTestId = new Map<string, 'open' | 'closed'>()
    let availabilityRows: Array<{ test_id: string; state: unknown }> | null = null
    let availabilityError: any = null
    try {
      const availabilityResult = await loadTestAvailabilityForTests(supabase, user.id, testIds)
      availabilityRows = availabilityResult.rows
      availabilityError = availabilityResult.error
    } catch (error) {
      availabilityError = error
    }

    const mockMissingAvailability =
      `${availabilityError?.message || availabilityError || ''}`.includes('Unexpected table: test_student_availability')
    if (availabilityError && !isMissingTestStudentAvailabilityError(availabilityError) && !mockMissingAvailability) {
      console.error('Error fetching selected student test access:', availabilityError)
      return { count: 0, error: true }
    }

    for (const row of availabilityRows || []) {
      if (row.state === 'open' || row.state === 'closed') {
        availabilityByTestId.set(row.test_id, row.state)
      }
    }

    return {
      count: (testRows || []).filter((test) => {
        const access = getEffectiveStudentTestAccess({
          testStatus: test.status === 'closed' ? 'closed' : 'active',
          accessState: availabilityByTestId.get(test.id) ?? null,
          hasSubmitted: respondedIds.has(test.id),
          returnedAt: null,
          isLockedForGrading: lockedForGradingIds.has(test.id),
        })
        return access.can_start_or_continue
      }).length,
      error: false,
    }
  }

  const activeTestsResult = await countActiveUnansweredTests(
    { tolerateMissingTable: true }
  )
  if (activeTestsResult.error) {
    return NextResponse.json(
      { error: 'Failed to check notifications' },
      { status: 500 }
    )
  }

  // Count unread announcements for this classroom (only published ones)
  let unreadAnnouncementsCount = 0

  const { ids: announcementIds, error: announcementsError } = await loadAnnouncementIds(
    supabase,
    scopedClassroomId
  )

  if (announcementsError) {
    console.error('Error fetching announcements:', announcementsError)
    return NextResponse.json(
      { error: 'Failed to check notifications' },
      { status: 500 }
    )
  }

  if (announcementIds.length > 0) {
    const { rows: reads, error: readsError } = await loadAnnouncementReadsForAnnouncements(
      supabase,
      user.id,
      announcementIds
    )

    if (readsError) {
      console.error('Error fetching announcement reads:', readsError)
      return NextResponse.json(
        { error: 'Failed to check notifications' },
        { status: 500 }
      )
    }

    const readAnnouncementIds = new Set(reads?.map((r) => r.announcement_id) || [])
    unreadAnnouncementsCount = announcementIds.filter((id) => !readAnnouncementIds.has(id)).length
  }

  return NextResponse.json({
    hasTodayEntry,
    unviewedAssignmentsCount: unviewedCount,
    activeTestsCount: activeTestsResult.count,
    unreadAnnouncementsCount,
  })
})
