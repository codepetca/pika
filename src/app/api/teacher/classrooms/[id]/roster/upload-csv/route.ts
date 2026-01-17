import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface ParsedStudent {
  email: string
  firstName: string
  lastName: string
  studentNumber: string
  counselorEmail: string | null
}

// POST /api/teacher/classrooms/[id]/roster/upload-csv - Upload CSV roster
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireRole('teacher')
    const classroomId = params.id
    const body = await request.json()
    const { csvData, confirmed } = body // CSV as string, confirmed flag for overwrite

    if (!csvData) {
      return NextResponse.json(
        { error: 'CSV data is required' },
        { status: 400 }
      )
    }

    const supabase = getServiceRoleClient()

    const ownership = await assertTeacherCanMutateClassroom(user.id, classroomId)
    if (!ownership.ok) {
      return NextResponse.json(
        { error: ownership.error },
        { status: ownership.status }
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

    // Expected format: Student Number,First Name,Last Name,Email[,Counselor Email]
    const students: ParsedStudent[] = []

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      const parts = line.split(',')
      if (parts.length < 4) continue

      const [studentNumber, firstName, lastName, email, counselorEmail] = parts.map((p: string) => p.trim())

      if (email && firstName && lastName) {
        students.push({
          email: email.toLowerCase().trim(),
          firstName,
          lastName,
          studentNumber,
          counselorEmail: counselorEmail || null,
        })
      }
    }

    if (students.length === 0) {
      return NextResponse.json(
        { error: 'No valid student data found in CSV' },
        { status: 400 }
      )
    }

    // If not confirmed, check for existing students that would be overwritten
    if (!confirmed) {
      const emails = students.map(s => s.email)
      const { data: existingStudents, error: selectError } = await supabase
        .from('classroom_roster')
        .select('id, email, first_name, last_name, student_number, counselor_email')
        .eq('classroom_id', classroomId)
        .in('email', emails)

      if (selectError) {
        console.error('Error checking existing students:', selectError)
        return NextResponse.json(
          { error: 'Failed to check existing roster' },
          { status: 500 }
        )
      }

      // If there are existing students, check if any have actual changes
      if (existingStudents && existingStudents.length > 0) {
        const existingByEmail = new Map(existingStudents.map(s => [s.email, s]))
        const studentsByEmail = new Map(students.map(s => [s.email, s]))
        const newCount = students.filter(s => !existingByEmail.has(s.email)).length

        // Build comparison data, only including students with actual changes
        const changes = existingStudents
          .map(existing => {
            const incoming = studentsByEmail.get(existing.email)!
            const hasChanges =
              existing.first_name !== incoming.firstName ||
              existing.last_name !== incoming.lastName ||
              existing.student_number !== incoming.studentNumber ||
              existing.counselor_email !== incoming.counselorEmail

            if (!hasChanges) return null

            return {
              email: existing.email,
              current: {
                firstName: existing.first_name,
                lastName: existing.last_name,
                studentNumber: existing.student_number,
                counselorEmail: existing.counselor_email,
              },
              incoming: {
                firstName: incoming.firstName,
                lastName: incoming.lastName,
                studentNumber: incoming.studentNumber,
                counselorEmail: incoming.counselorEmail,
              },
            }
          })
          .filter((change): change is NonNullable<typeof change> => change !== null)

        // Only require confirmation if there are actual changes
        if (changes.length > 0) {
          return NextResponse.json({
            needsConfirmation: true,
            changes,
            updateCount: changes.length,
            newCount,
            totalCount: students.length,
          })
        }
      }
    }

    // Proceed with upsert (either no existing students, or confirmed)
    const rosterRows = students.map((s) => ({
      classroom_id: classroomId,
      email: s.email,
      first_name: s.firstName || null,
      last_name: s.lastName || null,
      student_number: s.studentNumber || null,
      counselor_email: s.counselorEmail || null,
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
