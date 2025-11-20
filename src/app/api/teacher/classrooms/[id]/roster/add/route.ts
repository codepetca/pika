import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// POST /api/teacher/classrooms/[id]/roster/add - Add student(s) manually
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireRole('teacher')
    const classroomId = params.id
    const body = await request.json()
    const { students } = body // Array of { email, firstName, lastName, studentNumber }

    if (!students || !Array.isArray(students) || students.length === 0) {
      return NextResponse.json(
        { error: 'Students array is required' },
        { status: 400 }
      )
    }

    const supabase = getServiceRoleClient()

    // Verify ownership
    const { data: classroom, error: fetchError } = await supabase
      .from('classrooms')
      .select('teacher_id')
      .eq('id', classroomId)
      .single()

    if (fetchError || !classroom) {
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

    const addedStudents = []
    const errors = []

    for (const student of students) {
      const { email, firstName, lastName, studentNumber } = student

      if (!email || !firstName || !lastName) {
        errors.push({ email, error: 'Missing required fields' })
        continue
      }

      const normalizedEmail = email.toLowerCase().trim()

      try {
        // Check if user exists
        let { data: existingUser } = await supabase
          .from('users')
          .select('id, role')
          .eq('email', normalizedEmail)
          .single()

        let userId: string

        if (existingUser) {
          userId = existingUser.id

          // Update role to student if not already
          if (existingUser.role !== 'student') {
            await supabase
              .from('users')
              .update({ role: 'student' })
              .eq('id', userId)
          }
        } else {
          // Create new student user
          const { data: newUser, error: createError } = await supabase
            .from('users')
            .insert({
              email: normalizedEmail,
              role: 'student',
            })
            .select('id')
            .single()

          if (createError || !newUser) {
            errors.push({ email, error: 'Failed to create user' })
            continue
          }

          userId = newUser.id
        }

        // Create or update student profile
        await supabase
          .from('student_profiles')
          .upsert({
            user_id: userId,
            first_name: firstName,
            last_name: lastName,
            student_number: studentNumber || null,
          }, {
            onConflict: 'user_id'
          })

        // Add enrollment (skip if already enrolled)
        const { error: enrollError } = await supabase
          .from('classroom_enrollments')
          .insert({
            classroom_id: classroomId,
            student_id: userId,
          })

        if (enrollError && !enrollError.message?.includes('duplicate')) {
          errors.push({ email, error: 'Failed to enroll student' })
          continue
        }

        addedStudents.push({ email, userId })
      } catch (err: any) {
        errors.push({ email, error: err.message })
      }
    }

    return NextResponse.json({
      success: true,
      addedCount: addedStudents.length,
      added: addedStudents,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (error: any) {
    console.error('Add students error:', error)
    return NextResponse.json(
      { error: error.message || 'Unauthorized' },
      { status: 401 }
    )
  }
}
