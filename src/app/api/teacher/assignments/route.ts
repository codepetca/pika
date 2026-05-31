import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import {
  assertTeacherCanMutateClassroom,
  assertTeacherOwnsClassroom,
  getClassroomStudentIds,
} from '@/lib/server/classrooms'
import { buildAssignmentInstructionFields, getAssignmentInstructionsMarkdown } from '@/lib/assignment-instructions'
import { calculateAssignmentStats } from '@/lib/assignments'
import { withErrorHandler } from '@/lib/api-handler'
import { isMissingAssignmentTeacherClearedAtColumnError } from '@/lib/server/assignments'
import { isMissingSurveysTableError } from '@/lib/server/surveys'
import {
  loadAssignmentSubmissionRequirements,
  replaceAssignmentSubmissionRequirements,
} from '@/lib/server/assignment-submission-artifacts'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function isMissingClassworkMaterialPositionError(error: any) {
  const message = String(error?.message || '')
  return (
    error?.code === 'PGRST205' ||
    error?.code === 'PGRST204' ||
    message.includes('classwork_materials') ||
    (message.includes('position') && message.includes('schema cache'))
  )
}

type AssignmentStatsDocRow = {
  assignment_id: string
  student_id: string
  is_submitted: boolean
  submitted_at: string | null
  returned_at: string | null
  teacher_cleared_at: string | null
}

const ASSIGNMENT_LIST_STATS_FILTER_CHUNK_SIZE = 50
const ASSIGNMENT_LIST_STATS_COLUMNS =
  'assignment_id, student_id, is_submitted, submitted_at, returned_at, teacher_cleared_at'
const ASSIGNMENT_LIST_STATS_FALLBACK_COLUMNS =
  'assignment_id, student_id, is_submitted, submitted_at, returned_at'

function chunkIds(ids: string[], chunkSize: number): string[][] {
  const chunks: string[][] = []
  for (let index = 0; index < ids.length; index += chunkSize) {
    chunks.push(ids.slice(index, index + chunkSize))
  }
  return chunks
}

async function loadAssignmentDocsForListStats(
  supabase: any,
  assignmentIds: string[],
  studentIds: string[]
): Promise<{ docs: AssignmentStatsDocRow[]; error: any }> {
  if (assignmentIds.length === 0 || studentIds.length === 0) {
    return { docs: [], error: null }
  }

  const selectDocs = (columns: string, assignmentIdChunk: string[], studentIdChunk: string[]) =>
    supabase
      .from('assignment_docs')
      .select(columns)
      .in('assignment_id', assignmentIdChunk)
      .in('student_id', studentIdChunk)

  const docs: AssignmentStatsDocRow[] = []
  let useMailboxTracking = true

  for (const assignmentIdChunk of chunkIds(assignmentIds, ASSIGNMENT_LIST_STATS_FILTER_CHUNK_SIZE)) {
    for (const studentIdChunk of chunkIds(studentIds, ASSIGNMENT_LIST_STATS_FILTER_CHUNK_SIZE)) {
      if (useMailboxTracking) {
        const withMailboxTracking = await selectDocs(
          ASSIGNMENT_LIST_STATS_COLUMNS,
          assignmentIdChunk,
          studentIdChunk
        )

        if (!withMailboxTracking.error) {
          docs.push(...(withMailboxTracking.data || []))
          continue
        }

        if (!isMissingAssignmentTeacherClearedAtColumnError(withMailboxTracking.error)) {
          return { docs: [], error: withMailboxTracking.error }
        }

        useMailboxTracking = false
      }

      const fallback = await selectDocs(
        ASSIGNMENT_LIST_STATS_FALLBACK_COLUMNS,
        assignmentIdChunk,
        studentIdChunk
      )

      if (fallback.error) {
        return { docs: [], error: fallback.error }
      }

      docs.push(
        ...(fallback.data || []).map((doc: Omit<AssignmentStatsDocRow, 'teacher_cleared_at'>) => ({
          ...doc,
          teacher_cleared_at: null,
        }))
      )
    }
  }

  return { docs, error: null }
}

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

  const classroomStudentsResult = await getClassroomStudentIds(supabase, classroomId)
  if (classroomStudentsResult.error) {
    console.error('Error fetching classroom enrollments:', classroomStudentsResult.error)
    return NextResponse.json({ error: 'Failed to fetch classroom enrollments' }, { status: 500 })
  }

  const assignmentIds = (assignments || [])
    .map((assignment) => assignment.id)
    .filter((id): id is string => typeof id === 'string')

  const { docs: assignmentDocs, error: assignmentDocsError } = await loadAssignmentDocsForListStats(
    supabase,
    assignmentIds,
    classroomStudentsResult.studentIds
  )

  if (assignmentDocsError) {
    console.error('Error fetching assignment doc stats:', assignmentDocsError)
    return NextResponse.json({ error: 'Failed to fetch assignment stats' }, { status: 500 })
  }

  const docsByAssignmentId = new Map<string, AssignmentStatsDocRow[]>()
  for (const doc of assignmentDocs) {
    if (!classroomStudentsResult.studentIdSet.has(doc.student_id)) continue
    if (!docsByAssignmentId.has(doc.assignment_id)) {
      docsByAssignmentId.set(doc.assignment_id, [])
    }
    docsByAssignmentId.get(doc.assignment_id)!.push(doc)
  }

  const assignmentsWithStats = await Promise.all(
    (assignments || []).map(async (assignment) => {
      const stats = calculateAssignmentStats(
        assignment.due_at,
        docsByAssignmentId.get(assignment.id) || [],
        classroomStudentsResult.totalStudents
      )
      const submissionRequirements = await loadAssignmentSubmissionRequirements(supabase, assignment.id)

      return {
        ...assignment,
        instructions_markdown: getAssignmentInstructionsMarkdown(assignment).markdown,
        submission_requirements: submissionRequirements,
        stats,
      }
    })
  )

  return NextResponse.json({ assignments: assignmentsWithStats })
})

// POST /api/teacher/assignments - Create a new assignment
export const POST = withErrorHandler('PostTeacherAssignments', async (request, context) => {
  const user = await requireRole('teacher')
  const body = await request.json()
  const { classroom_id, title, instructions_markdown, rich_instructions, due_at, submission_requirements } = body

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

  const [lastAssignmentResult, lastMaterialResult, lastSurveyResult] = await Promise.all([
    supabase
      .from('assignments')
      .select('position')
      .eq('classroom_id', classroom_id)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('classwork_materials')
      .select('position')
      .eq('classroom_id', classroom_id)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('surveys')
      .select('position')
      .eq('classroom_id', classroom_id)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const lastAssignmentPosition =
    typeof lastAssignmentResult.data?.position === 'number' ? lastAssignmentResult.data.position : -1
  const lastMaterialPosition =
    !lastMaterialResult.error && typeof lastMaterialResult.data?.position === 'number'
      ? lastMaterialResult.data.position
      : -1
  const lastSurveyPosition =
    !lastSurveyResult.error && typeof lastSurveyResult.data?.position === 'number'
      ? lastSurveyResult.data.position
      : -1

  if (lastAssignmentResult.error) {
    console.error('Error fetching last assignment position:', lastAssignmentResult.error)
    return NextResponse.json({ error: 'Failed to create assignment' }, { status: 500 })
  }

  if (lastMaterialResult.error && !isMissingClassworkMaterialPositionError(lastMaterialResult.error)) {
    console.error('Error fetching last material position:', lastMaterialResult.error)
    return NextResponse.json({ error: 'Failed to create assignment' }, { status: 500 })
  }

  if (lastSurveyResult.error && !isMissingSurveysTableError(lastSurveyResult.error)) {
    console.error('Error fetching last survey position:', lastSurveyResult.error)
    return NextResponse.json({ error: 'Failed to create assignment' }, { status: 500 })
  }

  const nextPosition = Math.max(lastAssignmentPosition, lastMaterialPosition, lastSurveyPosition) + 1

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

  if (isMissingClassworkMaterialPositionError(lastMaterialResult.error)) {
    insertBody.position = lastAssignmentPosition + 1
  } else {
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

  const submissionRequirements = Array.isArray(submission_requirements)
    ? await replaceAssignmentSubmissionRequirements(supabase, assignment.id, submission_requirements)
    : []

  return NextResponse.json({
    assignment: {
      ...assignment,
      submission_requirements: submissionRequirements,
    },
  }, { status: 201 })
})
