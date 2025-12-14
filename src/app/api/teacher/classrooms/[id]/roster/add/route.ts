import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/classrooms/[id]/roster/add - Add roster allow-list rows manually (no auto-enrollment)
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

    const errors = []
    const rosterRows = []

    for (const student of students) {
      const { email, firstName, lastName, studentNumber } = student

      if (!email || !firstName || !lastName) {
        errors.push({ email, error: 'Missing required fields' })
        continue
      }

      const normalizedEmail = email.toLowerCase().trim()
      rosterRows.push({
        classroom_id: classroomId,
        email: normalizedEmail,
        first_name: firstName,
        last_name: lastName,
        student_number: studentNumber || null,
      })
    }

    if (rosterRows.length === 0) {
      return NextResponse.json(
        { error: 'No valid students to add' },
        { status: 400 }
      )
    }

    const { data: upserted, error: upsertError } = await supabase
      .from('classroom_roster')
      .upsert(rosterRows, { onConflict: 'classroom_id,email' })
      .select('id, email')

    if (upsertError) {
      console.error('Add roster error:', upsertError)
      return NextResponse.json(
        { error: 'Failed to add students' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      upsertedCount: upserted?.length ?? 0,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (error.name === 'AuthorizationError') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    console.error('Add students error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
