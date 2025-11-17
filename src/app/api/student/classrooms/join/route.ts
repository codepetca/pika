import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

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

    // Find classroom by code or ID
    let query = supabase
      .from('classrooms')
      .select('id, title, class_code, term_label')

    if (classroomId) {
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

    // Check if already enrolled
    const { data: existingEnrollment } = await supabase
      .from('classroom_enrollments')
      .select('id')
      .eq('classroom_id', classroom.id)
      .eq('student_id', user.id)
      .single()

    if (existingEnrollment) {
      // Already enrolled, return success
      return NextResponse.json({
        success: true,
        classroom,
        alreadyEnrolled: true,
      })
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

    return NextResponse.json({
      success: true,
      classroom,
      enrollment,
    }, { status: 201 })
  } catch (error: any) {
    console.error('Join classroom error:', error)
    return NextResponse.json(
      { error: error.message || 'Unauthorized' },
      { status: 401 }
    )
  }
}
