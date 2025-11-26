import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// POST /api/teacher/classrooms/[id]/roster/upload-csv - Upload CSV roster
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireRole('teacher')
    const classroomId = params.id
    const body = await request.json()
    const { csvData } = body // CSV as string

    if (!csvData) {
      return NextResponse.json(
        { error: 'CSV data is required' },
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

    // Parse CSV
    const lines = csvData.trim().split('\n')
    if (lines.length < 2) {
      return NextResponse.json(
        { error: 'CSV must have at least a header and one data row' },
        { status: 400 }
      )
    }

    // Expected format: Student Number,First Name,Last Name,Email
    const students = []

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      const parts = line.split(',')
      if (parts.length < 4) continue

      const [studentNumber, firstName, lastName, email] = parts.map((p: string) => p.trim())

      if (email && firstName && lastName) {
        students.push({
          email,
          firstName,
          lastName,
          studentNumber,
        })
      }
    }

    if (students.length === 0) {
      return NextResponse.json(
        { error: 'No valid student data found in CSV' },
        { status: 400 }
      )
    }

    const addedStudents = []
    const errors = []

    for (const student of students) {
      const { email, firstName, lastName, studentNumber } = student
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
      totalProcessed: students.length,
      addedCount: addedStudents.length,
      added: addedStudents,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (error: any) {
    console.error('Upload CSV error:', error)
    return NextResponse.json(
      { error: error.message || 'Unauthorized' },
      { status: 401 }
    )
  }
}
