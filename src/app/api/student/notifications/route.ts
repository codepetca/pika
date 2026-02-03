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

    // Count active quizzes the student hasn't responded to
    let activeQuizzesCount = 0

    const { data: activeQuizzes, error: quizzesError } = await supabase
      .from('quizzes')
      .select('id')
      .eq('classroom_id', classroomId)
      .eq('status', 'active')

    if (quizzesError) {
      console.error('Error fetching quizzes:', quizzesError)
      return NextResponse.json(
        { error: 'Failed to check notifications' },
        { status: 500 }
      )
    }

    const activeQuizIds = activeQuizzes?.map((q) => q.id) || []

    if (activeQuizIds.length > 0) {
      const { data: responses, error: responsesError } = await supabase
        .from('quiz_responses')
        .select('quiz_id')
        .eq('student_id', user.id)
        .in('quiz_id', activeQuizIds)

      if (responsesError) {
        console.error('Error fetching quiz responses:', responsesError)
        return NextResponse.json(
          { error: 'Failed to check notifications' },
          { status: 500 }
        )
      }

      const respondedQuizIds = new Set(responses?.map((r) => r.quiz_id) || [])
      activeQuizzesCount = activeQuizIds.filter((id) => !respondedQuizIds.has(id)).length
    }

    // Count unread announcements for this classroom
    let unreadAnnouncementsCount = 0

    const { data: announcements, error: announcementsError } = await supabase
      .from('announcements')
      .select('id')
      .eq('classroom_id', classroomId)

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
      activeQuizzesCount,
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
