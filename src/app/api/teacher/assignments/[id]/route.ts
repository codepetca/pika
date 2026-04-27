import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { calculateAssignmentStatus } from '@/lib/assignments'
import { extractAssignmentArtifacts } from '@/lib/assignment-artifacts'
import { buildAssignmentInstructionFields, getAssignmentInstructionsMarkdown } from '@/lib/assignment-instructions'
import { withErrorHandler } from '@/lib/api-handler'
import { getActiveAssignmentAiGradingRunSummary } from '@/lib/server/assignment-ai-grading-runs'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/teacher/assignments/[id] - Get assignment details with all student submissions
export const GET = withErrorHandler('GetTeacherAssignment', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const supabase = getServiceRoleClient()

  const { data: assignment, error: assignmentError } = await supabase
    .from('assignments')
    .select(`
      *,
      classrooms!inner (
        id,
        teacher_id,
        title,
        archived_at
      )
    `)
    .eq('id', id)
    .single()

  if (assignmentError || !assignment) {
    return NextResponse.json(
      { error: 'Assignment not found' },
      { status: 404 }
    )
  }

  if (assignment.classrooms.teacher_id !== user.id) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 403 }
    )
  }

  const { data: enrollments, error: enrollmentError } = await supabase
    .from('classroom_enrollments')
    .select(`
      student_id,
      users!inner (
        id,
        email
      )
    `)
    .eq('classroom_id', assignment.classroom_id)

  if (enrollmentError) {
    console.error('Error fetching enrollments:', enrollmentError)
    return NextResponse.json(
      { error: 'Failed to fetch students' },
      { status: 500 }
    )
  }

  const studentIds = enrollments?.map((enrollment) => enrollment.student_id) || []
  const { data: profiles } = await supabase
    .from('student_profiles')
    .select('user_id, first_name, last_name')
    .in('user_id', studentIds)

  const profileMap = new Map(
    profiles?.map((profile) => [
      profile.user_id,
      {
        first_name: profile.first_name,
        last_name: profile.last_name,
        full_name: `${profile.first_name} ${profile.last_name}`.trim(),
      },
    ]) || []
  )

  const { data: docs } = await supabase
    .from('assignment_docs')
    .select('*')
    .eq('assignment_id', id)

  const docMap = new Map(docs?.map((doc) => [doc.student_id, doc]) || [])
  const docIds = (docs || []).map((doc) => doc.id)

  const studentUpdatedAtByDocId = new Map<string, string>()
  if (docIds.length > 0) {
    const { data: historyRows } = await supabase
      .from('assignment_doc_history')
      .select('assignment_doc_id, created_at')
      .in('assignment_doc_id', docIds)

    for (const row of historyRows || []) {
      const existing = studentUpdatedAtByDocId.get(row.assignment_doc_id)
      if (!existing || row.created_at > existing) {
        studentUpdatedAtByDocId.set(row.assignment_doc_id, row.created_at)
      }
    }
  }

  const students = (enrollments || []).map((enrollment) => {
    const doc = docMap.get(enrollment.student_id)
    const status = calculateAssignmentStatus(assignment, doc)
    const userEmail = (enrollment.users as unknown as { id: string; email: string }).email
    const profile = profileMap.get(enrollment.student_id) || null
    const artifacts = doc ? extractAssignmentArtifacts(doc.content) : []

    return {
      student_id: enrollment.student_id,
      student_email: userEmail,
      student_first_name: profile?.first_name ?? null,
      student_last_name: profile?.last_name ?? null,
      student_name: profile?.full_name || null,
      status,
      student_updated_at: doc ? (studentUpdatedAtByDocId.get(doc.id) ?? null) : null,
      doc: doc
        ? {
            is_submitted: doc.is_submitted,
            submitted_at: doc.submitted_at,
            updated_at: doc.updated_at,
            score_completion: doc.score_completion,
            score_thinking: doc.score_thinking,
            score_workflow: doc.score_workflow,
            graded_at: doc.graded_at,
            returned_at: doc.returned_at,
            teacher_cleared_at: doc.teacher_cleared_at,
            feedback_returned_at: doc.feedback_returned_at,
          }
        : null,
      artifacts,
    }
  })

  students.sort((a, b) => {
    const nameA = a.student_name || a.student_email
    const nameB = b.student_name || b.student_email
    return nameA.localeCompare(nameB)
  })

  const activeAiGradingRun = await getActiveAssignmentAiGradingRunSummary(id)

  return NextResponse.json({
    assignment: {
      id: assignment.id,
      classroom_id: assignment.classroom_id,
      title: assignment.title,
      description: assignment.description,
      instructions_markdown: getAssignmentInstructionsMarkdown(assignment).markdown,
      rich_instructions: assignment.rich_instructions,
      due_at: assignment.due_at,
      position: assignment.position ?? 0,
      is_draft: assignment.is_draft ?? false,
      released_at: assignment.released_at ?? null,
      track_authenticity: assignment.track_authenticity ?? true,
      created_by: assignment.created_by,
      created_at: assignment.created_at,
      updated_at: assignment.updated_at,
    },
    classroom: assignment.classrooms,
    students,
    active_ai_grading_run: activeAiGradingRun,
  })
})

// PATCH /api/teacher/assignments/[id] - Update assignment
export const PATCH = withErrorHandler('PatchTeacherAssignment', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const body = await request.json()
  const { title, instructions_markdown, rich_instructions, due_at, is_draft, released_at } = body as {
    title?: string
    instructions_markdown?: string
    rich_instructions?: unknown
    due_at?: string
    is_draft?: boolean
    released_at?: string | null
  }

  const supabase = getServiceRoleClient()

  const { data: existing, error: existingError } = await supabase
    .from('assignments')
    .select(`
      *,
      classrooms!inner (
        teacher_id,
        archived_at
      )
    `)
    .eq('id', id)
    .single()

  if (existingError || !existing) {
    return NextResponse.json(
      { error: 'Assignment not found' },
      { status: 404 }
    )
  }

  if (existing.classrooms.teacher_id !== user.id) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 403 }
    )
  }

  if (existing.classrooms.archived_at) {
    return NextResponse.json(
      { error: 'Classroom is archived' },
      { status: 403 }
    )
  }

  if (is_draft !== undefined && typeof is_draft !== 'boolean') {
    return NextResponse.json(
      { error: 'is_draft must be a boolean' },
      { status: 400 }
    )
  }

  const updates: Record<string, any> = {}
  if (title !== undefined) updates.title = title.trim()
  if (instructions_markdown !== undefined || rich_instructions !== undefined) {
    const instructionFields = buildAssignmentInstructionFields(
      typeof instructions_markdown === 'string'
        ? instructions_markdown
        : getAssignmentInstructionsMarkdown({
            instructions_markdown: null,
            rich_instructions: rich_instructions as any,
            description: '',
          }).markdown
    )
    updates.instructions_markdown = instructionFields.instructions_markdown
    updates.rich_instructions = instructionFields.rich_instructions
    updates.description = instructionFields.description
  }
  if (due_at !== undefined) updates.due_at = due_at

  const now = new Date()
  const existingReleaseDate = existing.released_at ? new Date(existing.released_at) : null
  const existingIsLive = !existing.is_draft && (!existingReleaseDate || existingReleaseDate <= now)
  const existingIsScheduled = !existing.is_draft && !!existingReleaseDate && existingReleaseDate > now

  let parsedReleasedAt: string | null | undefined
  if (released_at !== undefined) {
    if (released_at === null) {
      parsedReleasedAt = now.toISOString()
    } else {
      const parsed = new Date(released_at)
      if (isNaN(parsed.getTime())) {
        return NextResponse.json(
          { error: 'Invalid release date' },
          { status: 400 }
        )
      }
      parsedReleasedAt = parsed > now ? parsed.toISOString() : now.toISOString()
    }
  }

  if (is_draft === true && existingIsLive) {
    return NextResponse.json(
      { error: 'Cannot revert an already released assignment to draft' },
      { status: 400 }
    )
  }

  if (released_at !== undefined && existingIsLive) {
    return NextResponse.json(
      { error: 'Cannot reschedule an already released assignment' },
      { status: 400 }
    )
  }

  if (is_draft === true) {
    updates.is_draft = true
    updates.released_at = null
  } else if (is_draft === false) {
    updates.is_draft = false
    if (parsedReleasedAt !== undefined) {
      updates.released_at = parsedReleasedAt
    } else if (existing.is_draft) {
      updates.released_at = now.toISOString()
    }
  } else if (released_at !== undefined) {
    if (existing.is_draft) {
      updates.is_draft = false
      updates.released_at = parsedReleasedAt ?? now.toISOString()
    } else if (existingIsScheduled) {
      updates.released_at = parsedReleasedAt ?? now.toISOString()
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: 'No updates provided' },
      { status: 400 }
    )
  }

  const { data: assignment, error } = await supabase
    .from('assignments')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error || !assignment) {
    console.error('Error updating assignment:', error)
    return NextResponse.json(
      { error: 'Failed to update assignment' },
      { status: 500 }
    )
  }

  return NextResponse.json({ assignment })
})

// DELETE /api/teacher/assignments/[id] - Delete assignment
export const DELETE = withErrorHandler('DeleteTeacherAssignment', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const supabase = getServiceRoleClient()

  const { data: existing, error: existingError } = await supabase
    .from('assignments')
    .select(`
      *,
      classrooms!inner (
        teacher_id,
        archived_at
      )
    `)
    .eq('id', id)
    .single()

  if (existingError || !existing) {
    return NextResponse.json(
      { error: 'Assignment not found' },
      { status: 404 }
    )
  }

  if (existing.classrooms.teacher_id !== user.id) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 403 }
    )
  }

  if (existing.classrooms.archived_at) {
    return NextResponse.json(
      { error: 'Classroom is archived' },
      { status: 403 }
    )
  }

  const { error } = await supabase
    .from('assignments')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('Error deleting assignment:', error)
    return NextResponse.json(
      { error: 'Failed to delete assignment' },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true })
})
