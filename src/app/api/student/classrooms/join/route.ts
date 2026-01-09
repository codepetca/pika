import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/student/classrooms/join - Join classroom by code or ID
export async function POST(request: NextRequest) {
  try {
    const user = await requireRole('student')
    const body = await request.json()
    const { classCode, classroomId } = body

    if (!classCode && !classroomId) {
      return NextResponse.json(
        { error: 'Class code or classroom ID is required' },
        { status: 400 }
      )
    }

    const supabase = getServiceRoleClient()
    const normalizedEmail = user.email.toLowerCase().trim()

    // Find classroom by code or ID
    let query = supabase
      .from('classrooms')
      .select('id, title, class_code, term_label, allow_enrollment, archived_at')

    const looksLikeUuid =
      typeof classroomId === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        classroomId
      )

    if (classroomId && looksLikeUuid) {
      query = query.eq('id', classroomId)
    } else {
      query = query.eq('class_code', classCode)
    }

    const { data: classroom, error: fetchError } = await query.single()

    if (fetchError || !classroom) {
      return NextResponse.json(
        { error: 'Classroom not found' },
        { status: 404 }
      )
    }

    if (classroom.archived_at) {
      return NextResponse.json(
        { error: 'Classroom not found' },
        { status: 404 }
      )
    }

    // Check if already enrolled
    const { data: existingEnrollment } = await supabase
      .from('classroom_enrollments')
      .select('id')
      .eq('classroom_id', classroom.id)
      .eq('student_id', user.id)
      .single()

    if (existingEnrollment) {
      // Best-effort sync: keep student profile aligned with roster entry.
      const { data: rosterEntry } = await supabase
        .from('classroom_roster')
        .select('student_number, first_name, last_name')
        .eq('classroom_id', classroom.id)
        .eq('email', normalizedEmail)
        .single()

      if (rosterEntry?.first_name && rosterEntry?.last_name) {
        await supabase
          .from('student_profiles')
          .upsert(
            {
              user_id: user.id,
              student_number: rosterEntry.student_number || null,
              first_name: rosterEntry.first_name,
              last_name: rosterEntry.last_name,
            },
            { onConflict: 'user_id' }
          )
      }

      // Already enrolled, return success
      return NextResponse.json({
        success: true,
        classroom,
        alreadyEnrolled: true,
      })
    }

    if (!classroom.allow_enrollment) {
      return NextResponse.json(
        { error: 'Enrollment is closed for this classroom.', code: 'enrollment_closed' },
        { status: 403 }
      )
    }

    const { data: rosterEntry, error: rosterError } = await supabase
      .from('classroom_roster')
      .select('student_number, first_name, last_name')
      .eq('classroom_id', classroom.id)
      .eq('email', normalizedEmail)
      .single()

    if (rosterError || !rosterEntry) {
      return NextResponse.json(
        { error: 'Your email is not on the roster for this classroom.', code: 'not_on_roster' },
        { status: 403 }
      )
    }

    // Enroll student
    const { data: enrollment, error: enrollError } = await supabase
      .from('classroom_enrollments')
      .insert({
        classroom_id: classroom.id,
        student_id: user.id,
      })
      .select()
      .single()

    if (enrollError) {
      console.error('Error enrolling student:', enrollError)
      return NextResponse.json(
        { error: 'Failed to join classroom' },
        { status: 500 }
      )
    }

    if (rosterEntry.first_name && rosterEntry.last_name) {
      await supabase
        .from('student_profiles')
        .upsert(
          {
            user_id: user.id,
            student_number: rosterEntry.student_number || null,
            first_name: rosterEntry.first_name,
            last_name: rosterEntry.last_name,
          },
          { onConflict: 'user_id' }
        )
    }

    return NextResponse.json({
      success: true,
      classroom,
      enrollment,
    }, { status: 201 })
  } catch (error: any) {
    // Authentication error (401)
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Authorization error (403)
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // All other errors (500)
    console.error('Join classroom error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
