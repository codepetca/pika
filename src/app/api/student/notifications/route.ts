import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { getTodayInToronto } from '@/lib/timezone'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/student/notifications?classroom_id=xxx
 * Returns notification state for the student sidebar:
 * - hasTodayEntry: whether student has saved any content for today
 * - unviewedAssignmentsCount: count of assignments not yet viewed
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireRole('student')
    const { searchParams } = new URL(request.url)
    const classroomId = searchParams.get('classroom_id')

    if (!classroomId) {
      return NextResponse.json(
        { error: 'classroom_id is required' },
        { status: 400 }
      )
    }

    const supabase = getServiceRoleClient()

    const access = await assertStudentCanAccessClassroom(user.id, classroomId)
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
      .eq('classroom_id', classroomId)
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
        .eq('classroom_id', classroomId)
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

    // Get all assignments for this classroom
    const { data: assignments, error: assignmentsError } = await supabase
      .from('assignments')
      .select('id')
      .eq('classroom_id', classroomId)
      .eq('is_draft', false)
      .not('released_at', 'is', null)

    if (assignmentsError) {
      console.error('Error fetching assignments:', assignmentsError)
      return NextResponse.json(
        { error: 'Failed to check notifications' },
        { status: 500 }
      )
    }

    // Count unviewed assignments
    let unviewedCount = 0
    const assignmentIds = assignments?.map((a) => a.id) || []

    if (assignmentIds.length > 0) {
      // Get this student's docs for these assignments
      const { data: docs, error: docsError } = await supabase
        .from('assignment_docs')
        .select('assignment_id, viewed_at')
        .eq('student_id', user.id)
        .in('assignment_id', assignmentIds)

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
        if (!doc || doc.viewed_at === null) {
          unviewedCount++
        }
      }
    }

    async function countActiveUnanswered(
      table: 'quizzes' | 'tests',
      responsesTable: 'quiz_responses' | 'test_responses',
      responseIdColumn: 'quiz_id' | 'test_id',
      opts?: { tolerateMissingTable?: boolean }
    ): Promise<{ count: number; error: boolean }> {
      const tolerateMissingTable = opts?.tolerateMissingTable === true

      const { data: activeRows, error: activeError } = await supabase
        .from(table)
        .select('id')
        .eq('classroom_id', classroomId)
        .eq('status', 'active')

      if (activeError) {
        if (tolerateMissingTable && activeError.code === 'PGRST205') {
          return { count: 0, error: false }
        }
        console.error(`Error fetching ${table}:`, activeError)
        return { count: 0, error: true }
      }

      const activeIds = activeRows?.map((row) => row.id) || []
      if (activeIds.length === 0) {
        return { count: 0, error: false }
      }

      const { data: responses, error: responsesError } = await supabase
        .from(responsesTable)
        .select(responseIdColumn)
        .eq('student_id', user.id)
        .in(responseIdColumn, activeIds)

      if (responsesError) {
        if (tolerateMissingTable && responsesError.code === 'PGRST205') {
          return { count: 0, error: false }
        }
        console.error(`Error fetching ${responsesTable}:`, responsesError)
        return { count: 0, error: true }
      }

      const respondedIds = new Set<string>()
      for (const row of responses || []) {
        const assessmentId =
          responseIdColumn === 'quiz_id'
            ? (row as { quiz_id: string }).quiz_id
            : (row as { test_id: string }).test_id
        if (assessmentId) {
          respondedIds.add(assessmentId)
        }
      }

      if (table === 'tests') {
        const { data: submittedAttempts, error: attemptsError } = await supabase
          .from('test_attempts')
          .select('test_id, is_submitted')
          .eq('student_id', user.id)
          .in('test_id', activeIds)

        if (attemptsError && attemptsError.code !== 'PGRST205') {
          console.error('Error fetching test_attempts:', attemptsError)
          return { count: 0, error: true }
        }

        for (const attempt of submittedAttempts || []) {
          if (attempt.is_submitted && attempt.test_id) {
            respondedIds.add(attempt.test_id)
          }
        }
      }

      return {
        count: activeIds.filter((id) => !respondedIds.has(id)).length,
        error: false,
      }
    }

    const activeQuizzesResult = await countActiveUnanswered(
      'quizzes',
      'quiz_responses',
      'quiz_id'
    )
    if (activeQuizzesResult.error) {
      return NextResponse.json(
        { error: 'Failed to check notifications' },
        { status: 500 }
      )
    }

    const activeTestsResult = await countActiveUnanswered(
      'tests',
      'test_responses',
      'test_id',
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

    const { data: announcements, error: announcementsError } = await supabase
      .from('announcements')
      .select('id')
      .eq('classroom_id', classroomId)
      .or('scheduled_for.is.null,scheduled_for.lte.now()')

    if (announcementsError) {
      console.error('Error fetching announcements:', announcementsError)
      return NextResponse.json(
        { error: 'Failed to check notifications' },
        { status: 500 }
      )
    }

    const announcementIds = announcements?.map((a) => a.id) || []

    if (announcementIds.length > 0) {
      const { data: reads, error: readsError } = await supabase
        .from('announcement_reads')
        .select('announcement_id')
        .eq('user_id', user.id)
        .in('announcement_id', announcementIds)

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
      activeQuizzesCount: activeQuizzesResult.count,
      activeTestsCount: activeTestsResult.count,
      unreadAnnouncementsCount,
    })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    console.error('Get notifications error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
