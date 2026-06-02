import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { getImageValidationError } from '@/lib/image-upload'
import { isAssignmentVisibleToStudents } from '@/lib/server/assignments'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'
import {
  isMissingAssignmentSubmissionSchemaError,
  loadUserGitHubIdentity,
} from '@/lib/server/assignment-submission-artifacts'
import {
  getGitHubIdentityValidationFromArtifact,
  normalizeGitHubLogin,
  validateAssignmentSubmissionArtifactValue,
} from '@/lib/server/assignment-submission-validation'
import { getServiceRoleClient } from '@/lib/supabase'
import type { AssignmentSubmissionArtifact, AssignmentSubmissionRequirement } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const ASSIGNMENT_ARTIFACTS_BUCKET = 'assignment-artifacts'
const SIGNED_IMAGE_URL_EXPIRES_SECONDS = 60 * 60

async function loadStudentAssignmentContext(opts: {
  assignmentId: string
  requirementId: string
  studentId: string
}) {
  const supabase = getServiceRoleClient()

  const { data: assignment, error: assignmentError } = await supabase
    .from('assignments')
    .select('id, classroom_id, is_draft, released_at')
    .eq('id', opts.assignmentId)
    .single()

  if (assignmentError || !assignment || !isAssignmentVisibleToStudents(assignment)) {
    return { kind: 'response' as const, response: NextResponse.json({ error: 'Assignment not found' }, { status: 404 }) }
  }

  const access = await assertStudentCanAccessClassroom(opts.studentId, assignment.classroom_id)
  if (!access.ok) {
    return { kind: 'response' as const, response: NextResponse.json({ error: access.error }, { status: access.status }) }
  }

  const { data: requirement, error: requirementError } = await supabase
    .from('assignment_submission_requirements')
    .select('*')
    .eq('id', opts.requirementId)
    .eq('assignment_id', opts.assignmentId)
    .single()

  if (requirementError || !requirement) {
    if (isMissingAssignmentSubmissionSchemaError(requirementError)) {
      return { kind: 'response' as const, response: NextResponse.json({ error: 'Submission requirements are not available yet.' }, { status: 503 }) }
    }
    return { kind: 'response' as const, response: NextResponse.json({ error: 'Requirement not found' }, { status: 404 }) }
  }

  const { data: existingDoc, error: docError } = await supabase
    .from('assignment_docs')
    .select('id, student_id, is_submitted')
    .eq('assignment_id', opts.assignmentId)
    .eq('student_id', opts.studentId)
    .maybeSingle()

  if (docError) {
    return { kind: 'response' as const, response: NextResponse.json({ error: 'Failed to load assignment doc' }, { status: 500 }) }
  }

  let doc = existingDoc
  if (!doc) {
    const { data: created, error: createError } = await supabase
      .from('assignment_docs')
      .insert({
        assignment_id: opts.assignmentId,
        student_id: opts.studentId,
        content: { type: 'doc', content: [] },
        repo_url: null,
        github_username: null,
        is_submitted: false,
        submitted_at: null,
        viewed_at: new Date().toISOString(),
      })
      .select('id, student_id, is_submitted')
      .single()

    if (createError || !created) {
      return { kind: 'response' as const, response: NextResponse.json({ error: 'Failed to create assignment doc' }, { status: 500 }) }
    }
    doc = created
  }

  if (doc.is_submitted) {
    return { kind: 'response' as const, response: NextResponse.json({ error: 'Cannot edit a submitted document' }, { status: 403 }) }
  }

  return {
    kind: 'context' as const,
    supabase,
    requirement: requirement as AssignmentSubmissionRequirement,
    doc,
  }
}

async function withSignedImageUrl(supabase: ReturnType<typeof getServiceRoleClient>, artifact: AssignmentSubmissionArtifact) {
  if (artifact.type !== 'image' || !artifact.storage_path) return artifact

  const { data } = await supabase.storage
    .from(ASSIGNMENT_ARTIFACTS_BUCKET)
    .createSignedUrl(artifact.storage_path, SIGNED_IMAGE_URL_EXPIRES_SECONDS)

  return {
    ...artifact,
    url: data?.signedUrl ?? artifact.url,
  }
}

export const PUT = withErrorHandler('PutAssignmentSubmissionArtifact', async (request: NextRequest, context) => {
  const user = await requireRole('student')
  const { id: assignmentId, requirementId } = await context.params
  const result = await loadStudentAssignmentContext({ assignmentId, requirementId, studentId: user.id })
  if (result.kind === 'response') return result.response

  const { requirement, supabase, doc } = result
  if (requirement.type === 'image') {
    return NextResponse.json({ error: 'Use image upload for screenshot requirements.' }, { status: 400 })
  }

  const body = await request.json()
  const url = typeof body.url === 'string' ? body.url : ''
  const identity = requirement.type === 'repo_link'
    ? await loadUserGitHubIdentity(supabase, user.id)
    : null
  const githubLogin = requirement.type === 'repo_link'
    ? normalizeGitHubLogin(typeof body.github_login === 'string' ? body.github_login : identity?.github_login)
    : null

  const validation = await validateAssignmentSubmissionArtifactValue({
    type: requirement.type,
    url,
    githubLogin,
    validationPolicy: requirement.validation_policy_json,
  })

  const metadata = {
    ...validation.metadata_json,
    ...(githubLogin ? { github_login: githubLogin } : {}),
  }

  const { data: artifact, error } = await supabase
    .from('assignment_submission_artifacts')
    .upsert({
      assignment_doc_id: doc.id,
      requirement_id: requirement.id,
      student_id: user.id,
      type: requirement.type,
      url: validation.normalized_url ?? url.trim(),
      storage_path: null,
      metadata_json: metadata,
      validation_status: validation.validation_status,
      validation_message: validation.validation_message,
      validated_at: new Date().toISOString(),
    }, { onConflict: 'assignment_doc_id,requirement_id' })
    .select('*')
    .single()

  if (error || !artifact) {
    if (isMissingAssignmentSubmissionSchemaError(error)) {
      return NextResponse.json({ error: 'Submission artifacts are not available yet.' }, { status: 503 })
    }
    throw new Error('Failed to save submission artifact')
  }

  if (requirement.type === 'repo_link' && githubLogin && body.save_github_login !== false) {
    const identityValidation = getGitHubIdentityValidationFromArtifact(validation)
    await supabase
      .from('user_github_identities')
      .upsert({
        user_id: user.id,
        github_login: githubLogin,
        validation_status: identityValidation.validation_status,
        validation_message: identityValidation.validation_message,
        validated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
  }

  return NextResponse.json({ artifact })
})

export const POST = withErrorHandler('PostAssignmentSubmissionArtifactImage', async (request: NextRequest, context) => {
  const user = await requireRole('student')
  const { id: assignmentId, requirementId } = await context.params
  const result = await loadStudentAssignmentContext({ assignmentId, requirementId, studentId: user.id })
  if (result.kind === 'response') return result.response

  const { requirement, supabase, doc } = result
  if (requirement.type !== 'image') {
    return NextResponse.json({ error: 'Image upload is only available for screenshot requirements.' }, { status: 400 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  const validationError = getImageValidationError(file)
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 })
  }

  const { data: previousArtifact } = await supabase
    .from('assignment_submission_artifacts')
    .select('id, storage_path')
    .eq('assignment_doc_id', doc.id)
    .eq('requirement_id', requirement.id)
    .maybeSingle()

  const ext = file.name.split('.').pop() || 'png'
  const storagePath = `${user.id}/${assignmentId}/${requirement.id}-${Date.now()}-${crypto.randomUUID()}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())
  const { error: uploadError } = await supabase.storage
    .from(ASSIGNMENT_ARTIFACTS_BUCKET)
    .upload(storagePath, buffer, {
      contentType: file.type,
      upsert: false,
    })

  if (uploadError) {
    throw new Error('Failed to upload image')
  }

  const signed = await supabase.storage
    .from(ASSIGNMENT_ARTIFACTS_BUCKET)
    .createSignedUrl(storagePath, SIGNED_IMAGE_URL_EXPIRES_SECONDS)
  const signedUrl = signed.data?.signedUrl ?? null

  const validation = await validateAssignmentSubmissionArtifactValue({
    type: 'image',
    storagePath,
    url: signedUrl,
  })

  const { data: artifact, error } = await supabase
    .from('assignment_submission_artifacts')
    .upsert({
      assignment_doc_id: doc.id,
      requirement_id: requirement.id,
      student_id: user.id,
      type: requirement.type,
      url: null,
      storage_path: storagePath,
      metadata_json: {
        file_name: file.name,
        file_size: file.size,
        content_type: file.type,
      },
      validation_status: validation.validation_status,
      validation_message: validation.validation_message,
      validated_at: new Date().toISOString(),
    }, { onConflict: 'assignment_doc_id,requirement_id' })
    .select('*')
    .single()

  if (error || !artifact) {
    await supabase.storage
      .from(ASSIGNMENT_ARTIFACTS_BUCKET)
      .remove([storagePath])

    if (isMissingAssignmentSubmissionSchemaError(error)) {
      return NextResponse.json({ error: 'Submission artifacts are not available yet.' }, { status: 503 })
    }
    throw new Error('Failed to save image artifact')
  }

  if (previousArtifact?.storage_path && previousArtifact.storage_path !== storagePath) {
    await supabase.storage
      .from(ASSIGNMENT_ARTIFACTS_BUCKET)
      .remove([previousArtifact.storage_path])
  }

  return NextResponse.json({ artifact: await withSignedImageUrl(supabase, artifact as AssignmentSubmissionArtifact) })
})

export const DELETE = withErrorHandler('DeleteAssignmentSubmissionArtifact', async (request, context) => {
  const user = await requireRole('student')
  const { id: assignmentId, requirementId } = await context.params
  const result = await loadStudentAssignmentContext({ assignmentId, requirementId, studentId: user.id })
  if (result.kind === 'response') return result.response

  const { supabase, doc } = result
  const { data: existing } = await supabase
    .from('assignment_submission_artifacts')
    .select('id, storage_path')
    .eq('assignment_doc_id', doc.id)
    .eq('requirement_id', requirementId)
    .maybeSingle()

  if (existing?.storage_path) {
    await supabase.storage
      .from(ASSIGNMENT_ARTIFACTS_BUCKET)
      .remove([existing.storage_path])
  }

  const { error } = await supabase
    .from('assignment_submission_artifacts')
    .delete()
    .eq('assignment_doc_id', doc.id)
    .eq('requirement_id', requirementId)

  if (error && !isMissingAssignmentSubmissionSchemaError(error)) {
    throw new Error('Failed to delete submission artifact')
  }

  return NextResponse.json({ ok: true })
})
