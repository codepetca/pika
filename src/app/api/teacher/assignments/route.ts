import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertTeacherCanMutateClassroom, assertTeacherOwnsClassroom } from '@/lib/server/classrooms'
import { buildAssignmentInstructionFields, getAssignmentInstructionsMarkdown } from '@/lib/assignment-instructions'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/teacher/assignments?classroom_id=xxx - List assignments for a classroom
export const GET = withErrorHandler('GetTeacherAssignments', async (request, context) => {
  const user = await requireRole('teacher')
  const { searchParams } = new URL(request.url)
  const classroomId = searchParams.get('classroom_id')

  if (!classroomId) {
    return NextResponse.json(
      { error: 'classroom_id is required' },
      { status: 400 }
    )
  }

  const ownership = await assertTeacherOwnsClassroom(user.id, classroomId)
  if (!ownership.ok) {
    return NextResponse.json(
      { error: ownership.error },
      { status: ownership.status }
    )
  }

  const supabase = getServiceRoleClient()

  let assignments: any[] | null = null
  const withPosition = await supabase
    .from('assignments')
    .select('*')
    .eq('classroom_id', classroomId)
    .order('position', { ascending: true })
    .order('due_at', { ascending: true })

  if (withPosition.error) {
    const fallback = await supabase
      .from('assignments')
      .select('*')
      .eq('classroom_id', classroomId)
      .order('due_at', { ascending: true })

    if (fallback.error) {
      console.error('Error fetching assignments:', fallback.error)
      return NextResponse.json({ error: 'Failed to fetch assignments' }, { status: 500 })
    }

    assignments = fallback.data
  } else {
    assignments = withPosition.data
  }

  const { count: totalStudents } = await supabase
    .from('classroom_enrollments')
    .select('*', { count: 'exact', head: true })
    .eq('classroom_id', classroomId)

  const assignmentsWithStats = await Promise.all(
    (assignments || []).map(async (assignment) => {
      const { data: docs } = await supabase
        .from('assignment_docs')
        .select('is_submitted, submitted_at')
        .eq('assignment_id', assignment.id)
        .eq('is_submitted', true)

      const submitted = docs?.length || 0
      const dueAt = new Date(assignment.due_at)
      const late = docs?.filter((doc) => doc.submitted_at && new Date(doc.submitted_at) > dueAt).length || 0

      return {
        ...assignment,
        instructions_markdown: getAssignmentInstructionsMarkdown(assignment).markdown,
        stats: {
          total_students: totalStudents || 0,
          submitted,
          late,
        },
      }
    })
  )

  return NextResponse.json({ assignments: assignmentsWithStats })
})

// POST /api/teacher/assignments - Create a new assignment
export const POST = withErrorHandler('PostTeacherAssignments', async (request, context) => {
  const user = await requireRole('teacher')
  const body = await request.json()
  const { classroom_id, title, instructions_markdown, rich_instructions, due_at } = body

  if (!classroom_id) {
    return NextResponse.json(
      { error: 'classroom_id is required' },
      { status: 400 }
    )
  }
  if (!title || !title.trim()) {
    return NextResponse.json(
      { error: 'Title is required' },
      { status: 400 }
    )
  }
  if (!due_at) {
    return NextResponse.json(
      { error: 'Due date is required' },
      { status: 400 }
    )
  }
  const ownership = await assertTeacherCanMutateClassroom(user.id, classroom_id)
  if (!ownership.ok) {
    return NextResponse.json(
      { error: ownership.error },
      { status: ownership.status }
    )
  }

  const supabase = getServiceRoleClient()

  const lastAssignmentResult = await supabase
    .from('assignments')
    .select('position')
    .eq('classroom_id', classroom_id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextPosition =
    typeof lastAssignmentResult.data?.position === 'number' ? lastAssignmentResult.data.position + 1 : 0

  const instructionFields = buildAssignmentInstructionFields(
    typeof instructions_markdown === 'string'
      ? instructions_markdown
      : getAssignmentInstructionsMarkdown({
          instructions_markdown: null,
          rich_instructions: rich_instructions ?? null,
          description: '',
        }).markdown
  )
  const insertBody: Record<string, any> = {
    classroom_id,
    title: title.trim(),
    instructions_markdown: instructionFields.instructions_markdown,
    rich_instructions: instructionFields.rich_instructions,
    description: instructionFields.description,
    due_at,
    created_by: user.id,
    track_authenticity: true,
  }

  if (!lastAssignmentResult.error) {
    insertBody.position = nextPosition
  }

  const { data: assignment, error } = await supabase
    .from('assignments')
    .insert(insertBody)
    .select()
    .single()

  if (error || !assignment) {
    console.error('Error creating assignment:', error)
    return NextResponse.json(
      { error: 'Failed to create assignment' },
      { status: 500 }
    )
  }

  return NextResponse.json({ assignment }, { status: 201 })
})
