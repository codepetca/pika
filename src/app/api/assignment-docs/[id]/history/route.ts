import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireAuth()
    const { id: assignmentId } = params
    const supabase = getServiceRoleClient()
    const { searchParams } = new URL(request.url)
    const requestedStudentId = searchParams.get('student_id')

    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      .select(`
        id,
        classroom_id,
        classrooms!inner (
          id,
          teacher_id
        )
      `)
      .eq('id', assignmentId)
      .single()

    if (assignmentError || !assignment) {
      return NextResponse.json(
        { error: 'Assignment not found' },
        { status: 404 }
      )
    }

    let studentId = user.id

    const assignmentData = assignment as {
      classroom_id: string
      classrooms: { teacher_id: string } | { teacher_id: string }[]
    }

    const classroomTeacherId = Array.isArray(assignmentData.classrooms)
      ? assignmentData.classrooms[0]?.teacher_id
      : assignmentData.classrooms?.teacher_id

    if (user.role === 'teacher') {
      if (classroomTeacherId !== user.id) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 403 }
        )
      }
      if (!requestedStudentId) {
        return NextResponse.json(
          { error: 'student_id is required' },
          { status: 400 }
        )
      }
      studentId = requestedStudentId
    } else {
      const access = await assertStudentCanAccessClassroom(user.id, assignmentData.classroom_id)
      if (!access.ok) {
        return NextResponse.json(
          { error: access.error },
          { status: access.status }
        )
      }
    }

    const { data: enrollment } = await supabase
      .from('classroom_enrollments')
      .select('id')
      .eq('classroom_id', assignmentData.classroom_id)
      .eq('student_id', studentId)
      .single()

    if (!enrollment) {
      return NextResponse.json(
        { error: 'Not enrolled in this classroom' },
        { status: 403 }
      )
    }

    const { data: doc } = await supabase
      .from('assignment_docs')
      .select('id')
      .eq('assignment_id', assignmentId)
      .eq('student_id', studentId)
      .single()

    if (!doc) {
      return NextResponse.json({ history: [], docId: null })
    }

    const { data: history, error: historyError } = await supabase
      .from('assignment_doc_history')
      .select('id, assignment_doc_id, patch, snapshot, word_count, char_count, trigger, created_at')
      .eq('assignment_doc_id', doc.id)
      .order('created_at', { ascending: false })

    if (historyError) {
      console.error('Error fetching assignment doc history:', historyError)
      return NextResponse.json(
        { error: 'Failed to fetch history' },
        { status: 500 }
      )
    }

    return NextResponse.json({ history: history || [], docId: doc.id })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.error('Get assignment doc history error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
