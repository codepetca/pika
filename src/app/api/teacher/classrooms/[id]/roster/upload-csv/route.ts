import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import { withErrorHandler } from '@/lib/api-handler'
import { restoreRemovedClassroomStudents } from '@/lib/server/classroom-student-removal'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface ParsedStudent {
  email: string
  firstName: string
  lastName: string
  studentNumber: string | null
  counselorEmail: string | null
}

function parseCsvField(value: string | undefined) {
  const trimmed = (value || '').trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"').trim()
  }
  return trimmed
}

function normalizeCsvHeader(value: string | undefined) {
  return parseCsvField(value).toLowerCase().replace(/[^a-z0-9]/g, '')
}

// POST /api/teacher/classrooms/[id]/roster/upload-csv - Upload CSV roster
export const POST = withErrorHandler('PostUploadRosterCsv', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: classroomId } = await context.params
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
  const lines = csvData.trim().split(/\r?\n/)
  if (lines.length < 2) {
    return NextResponse.json(
      { error: 'CSV must have at least a header and one data row' },
      { status: 400 }
    )
  }

  // Expected format: Student Number,First Name,Last Name,Email[,Secondary email].
  // Student Number is optional when the header starts with First Name.
  const hasStudentNumberColumn = normalizeCsvHeader(lines[0].split(',')[0]).includes('student')
  const students: ParsedStudent[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const parts = line.split(',').map(parseCsvField)
    const [rawStudentNumber, firstName, lastName, email, counselorEmail] = hasStudentNumberColumn
      ? parts
      : [undefined, ...parts]
    const studentNumber = rawStudentNumber || null

    if (email && firstName && lastName) {
      students.push({
        email: email.toLowerCase().trim(),
        firstName,
        lastName,
        studentNumber,
        counselorEmail: counselorEmail?.toLowerCase().trim() || null,
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
    join_source: 'csv',
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

  const restoredCount = await restoreRemovedClassroomStudents(user.id, classroomId, rosterRows.map((row) => row.email))
  return NextResponse.json({
    success: true,
    restoredCount,
    totalProcessed: students.length,
    upsertedCount: upserted?.length ?? 0,
  })
})
