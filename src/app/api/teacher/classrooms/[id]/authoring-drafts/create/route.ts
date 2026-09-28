import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { classroomGuidedDraftCreateSchema } from '@/lib/validations/classroom-guided-drafts'
import { getClassroomAuthoringGuidance } from '@/lib/server/classroom-authoring-guidance'
import { resolveCourseBlueprintAuthoringContext } from '@/lib/course-blueprint-authoring-context'
import { verifyClassroomDraftProvenanceToken } from '@/lib/server/classroom-draft-provenance'
import { parseClassroomGuidedDraft } from '@/lib/server/classroom-guided-draft-create'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function createError(error: { code?: string } | null) {
  switch (error?.code) {
    case 'P0002': return { status: 404, message: 'Classroom Blueprint Version is unavailable' }
    case '42501': return { status: 403, message: 'Forbidden' }
    case '55000': return { status: 403, message: 'Classroom is archived' }
    case '40001': return { status: 409, message: 'The Classroom Blueprint Version changed. Generate a new draft.' }
    case '22023': return { status: 409, message: 'The frozen Blueprint guidance changed or the edited draft is invalid.' }
    case '23505': return { status: 409, message: 'This draft was already created.' }
    default: return { status: 500, message: 'Failed to create the guided draft' }
  }
}

export const POST = withErrorHandler('PostTeacherClassroomAuthoringDraftCreate', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const body = classroomGuidedDraftCreateSchema.parse(await request.json())
  const result = await getClassroomAuthoringGuidance(user.id, id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  if (!result.context) {
    return NextResponse.json({ error: 'This Classroom has no Blueprint Version guidance' }, { status: 409 })
  }
  const source = result.context
  if (body.unit_exception_id && !source.guidance.unit_exceptions.some((unit) => unit.id === body.unit_exception_id)) {
    return NextResponse.json({ error: 'The selected unit guidance is no longer available' }, { status: 409 })
  }
  const provenance = {
    source_blueprint_version_id: source.source_blueprint_version_id,
    source_blueprint_version_number: source.source_blueprint_version_number,
    source_draft_revision: source.source_draft_revision,
    ...resolveCourseBlueprintAuthoringContext({
      guidance: source.guidance,
      target: body.target,
      unitExceptionId: body.unit_exception_id,
    }),
  }
  if (!verifyClassroomDraftProvenanceToken({
    token: body.draft_provenance_token,
    teacherId: user.id,
    classroomId: id,
    draftId: body.draft_id,
    provenance,
    seedContentSha256: body.original_content_sha256,
  })) {
    return NextResponse.json({ error: 'This draft preview is invalid or expired. Generate a new draft.' }, { status: 409 })
  }

  const parsed = parseClassroomGuidedDraft(body.target, body.content)
  if (!parsed.ok) {
    return NextResponse.json({ error: 'Invalid edited draft', errors: parsed.errors }, { status: 400 })
  }
  const supabase = getServiceRoleClient()
  // The migration's RPCs are typed after the local migration-schema replay.
  const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown; error: { code?: string; message?: string } | null
  }>
  const shared = {
    p_actor_id: user.id,
    p_classroom_id: id,
    p_expected_blueprint_version_id: source.source_blueprint_version_id,
    p_unit_exception_id: provenance.unit_exception_id,
    p_draft_id: body.draft_id,
    p_rules_markdown: provenance.rules_markdown,
    p_seed_sha256: body.original_content_sha256,
  }
  const created = parsed.draft.target === 'assignments'
    ? await rpc('create_guided_assignment_for_owner_v1', {
      ...shared,
      p_title: parsed.draft.title,
      p_description: parsed.draft.description,
      p_instructions_markdown: parsed.draft.instructionsMarkdown,
      p_rich_instructions: parsed.draft.richInstructions,
      p_due_at: parsed.draft.dueAt,
      p_requirements: parsed.draft.requirements,
      p_points_possible: parsed.draft.pointsPossible,
    })
    : await rpc('create_guided_test_for_owner_v1', {
      ...shared,
      p_draft_content: parsed.draft.draftContent,
      p_documents: parsed.draft.documents,
    })
  if (created.error) {
    const mapped = createError(created.error)
    if (mapped.status === 500) console.error('Guided classroom draft creation failed:', created.error)
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
  const data = created.data as Record<string, unknown> | null
  if (!data || typeof data !== 'object' || data.ok !== true) {
    return NextResponse.json({ error: 'Failed to create the guided draft' }, { status: 500 })
  }
  const artifact = parsed.draft.target === 'assignments' ? 'assignment' : 'test'
  if (!(artifact in data)) {
    return NextResponse.json({ error: 'Failed to create the guided draft' }, { status: 500 })
  }
  const value = artifact === 'assignment' && data.assignment && typeof data.assignment === 'object'
    ? { ...data.assignment, submission_requirements: data.submission_requirements ?? [] }
    : data[artifact]
  return NextResponse.json({ [artifact]: value }, { status: 201 })
})
