import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function cleanOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

// POST /api/student/classrooms/join - Join classroom by code or ID
export const POST = withErrorHandler('PostStudentJoinClassroom', async (request, context) => {
  const user = await requireRole('student')
  const body = await request.json()
  const { classCode, classroomId } = body
  const firstName = cleanOptionalString(body.firstName)
  const lastName = cleanOptionalString(body.lastName)
  const studentNumber = cleanOptionalString(body.studentNumber)

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
    .select('id, title, class_code, term_label, allow_enrollment, join_policy, archived_at')

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

  const joinPolicy = classroom.join_policy === 'open_join' ? 'open_join' : 'roster'

  const { data: rosterEntry, error: rosterError } = await supabase
    .from('classroom_roster')
    .select('student_number, first_name, last_name')
    .eq('classroom_id', classroom.id)
    .eq('email', normalizedEmail)
    .single()

  if (rosterError && rosterError.code !== 'PGRST116') {
    console.error('Error checking classroom roster:', rosterError)
    return NextResponse.json(
      { error: 'Failed to join classroom' },
      { status: 500 }
    )
  }

  let effectiveRosterEntry = rosterEntry

  if (!effectiveRosterEntry && joinPolicy === 'roster') {
    return NextResponse.json(
      { error: 'Your email is not on the roster for this classroom.', code: 'not_on_roster' },
      { status: 403 }
    )
  }

  if (!effectiveRosterEntry && joinPolicy === 'open_join') {
    if (!firstName || !lastName) {
      return NextResponse.json(
        {
          error: 'First name and last name are required to join this classroom.',
          code: 'profile_required',
          requiredFields: ['firstName', 'lastName'],
        },
        { status: 400 }
      )
    }

    effectiveRosterEntry = {
      student_number: studentNumber,
      first_name: firstName,
      last_name: lastName,
    }

    const { error: rosterUpsertError } = await supabase
      .from('classroom_roster')
      .upsert(
        {
          classroom_id: classroom.id,
          email: normalizedEmail,
          student_number: studentNumber,
          first_name: firstName,
          last_name: lastName,
          counselor_email: null,
          join_source: 'open_join',
        },
        { onConflict: 'classroom_id,email' }
      )

    if (rosterUpsertError) {
      console.error('Error creating open-join roster row:', rosterUpsertError)
      return NextResponse.json(
        { error: 'Failed to join classroom' },
        { status: 500 }
      )
    }
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

  if (effectiveRosterEntry?.first_name && effectiveRosterEntry?.last_name) {
    await supabase
      .from('student_profiles')
      .upsert(
        {
          user_id: user.id,
          student_number: effectiveRosterEntry.student_number || null,
          first_name: effectiveRosterEntry.first_name,
          last_name: effectiveRosterEntry.last_name,
        },
        { onConflict: 'user_id' }
      )
  }

  return NextResponse.json({
    success: true,
    classroom,
    enrollment,
  }, { status: 201 })
})
