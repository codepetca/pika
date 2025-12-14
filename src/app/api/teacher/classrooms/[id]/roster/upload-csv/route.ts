import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

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

    const rosterRows = students.map((s: any) => ({
      classroom_id: classroomId,
      email: s.email.toLowerCase().trim(),
      first_name: s.firstName || null,
      last_name: s.lastName || null,
      student_number: s.studentNumber || null,
    }))

    const { data: upserted, error: upsertError } = await supabase
      .from('classroom_roster')
      .upsert(rosterRows, { onConflict: 'classroom_id,email' })
      .select('id, email')

    if (upsertError) {
      console.error('Roster upsert error:', upsertError)
      return NextResponse.json(
        { error: 'Failed to upload roster CSV' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      totalProcessed: students.length,
      upsertedCount: upserted?.length ?? 0,
    })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (error.name === 'AuthorizationError') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    console.error('Upload CSV error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
