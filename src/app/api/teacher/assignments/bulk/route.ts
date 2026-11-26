import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import { buildAssignmentInstructionFields } from '@/lib/assignment-instructions'
import { withErrorHandler } from '@/lib/api-handler'
import { authorizeContextualAssignmentBulkRequest } from '@/lib/server/contextual-assignment-bulk-access'
import { saveAssignmentsBulkForOwner } from '@/lib/server/contextual-assignment-bulk'
import { assignmentBulkSchema } from '@/lib/validations/assignment-bulk'
import type { Json } from '@/types/database.generated'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Every batch, including legacy draft-only sync, uses the owner transaction.
export const POST = withErrorHandler('PostTeacherAssignmentsBulk', async request => {
  let bodyPromise: Promise<ReturnType<typeof assignmentBulkSchema.parse>> | undefined
  const readBody = () => bodyPromise ??= (async () => assignmentBulkSchema.parse(await request.json()))()
  const access = await authorizeContextualAssignmentBulkRequest(async () => (await readBody()).classroom_id)
  const body = await readBody()

  if (access.mode === 'legacy') {
    const ownership = await assertTeacherCanMutateClassroom(access.user.id, body.classroom_id)
    if (!ownership.ok) return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  }

  const result = await saveAssignmentsBulkForOwner({
    supabase: getServiceRoleClient(),
    actorId: access.user.id,
    classroomId: access.classroomId,
    preserveLegacyHistory: access.mode === 'legacy',
    assignments: body.assignments.map(assignment => {
      const fields = buildAssignmentInstructionFields(assignment.instructions)
      return {
        ...(assignment.id ? { id: assignment.id } : {}),
        title: assignment.title,
        dueAt: assignment.due_at,
        instructionsMarkdown: fields.instructions_markdown,
        description: fields.description,
        richInstructions: fields.rich_instructions as unknown as Json,
        isDraft: access.mode === 'legacy' && !assignment.id ? true : assignment.is_draft ?? true,
      }
    }),
  })
  if (!result.ok) return NextResponse.json({ errors: result.errors }, { status: 400 })
  return NextResponse.json({ created: result.created, updated: result.updated, assignments: result.assignments })
})
