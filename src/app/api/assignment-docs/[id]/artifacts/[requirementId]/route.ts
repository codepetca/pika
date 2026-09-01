import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { getImageValidationError } from '@/lib/image-upload'
import { isAssignmentVisibleToStudents } from '@/lib/server/assignments'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'
import {
  deleteAssignmentSubmissionArtifactAtomic,
  isMissingAssignmentSubmissionSchemaError,
  loadUserGitHubIdentity,
} from '@/lib/server/assignment-submission-artifacts'
import {
  adoptProvisionalAssignmentArtifactStorageCleanup,
  assignmentArtifactStoragePathIsReferenced,
  createProvisionalAssignmentArtifactStorageCleanup,
  enqueueAssignmentArtifactStorageCleanupPath,
  removeQueuedAssignmentArtifactStoragePath,
  type ProvisionalAssignmentArtifactStorageCleanup,
} from '@/lib/server/assignment-artifact-storage-cleanup'
import {
  getGitHubIdentityValidationFromArtifact,
  normalizeGitHubLogin,
  validateAssignmentSubmissionArtifactValue,
} from '@/lib/server/assignment-submission-validation'
import { getServiceRoleClient } from '@/lib/supabase'
import { assignmentArtifactPutRequestSchema } from '@/lib/validations/assignment-doc-submissions'
import type { AssignmentSubmissionArtifact, AssignmentSubmissionRequirement } from '@/types'
import {
  queueManagedStorageCleanupBestEffort,
  reserveManagedStorageUpload,
  verifyManagedStorageUpload,
} from '@/lib/server/managed-storage'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const ASSIGNMENT_ARTIFACTS_BUCKET = 'assignment-artifacts'
const SIGNED_IMAGE_URL_EXPIRES_SECONDS = 60 * 60

function isSubmittedArtifactMutationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const record = error as { code?: string; message?: string }
  return (
    record.code === '23514'
    && record.message?.includes('assignment_artifact_submitted_document_immutable') === true
  )
}

function submittedArtifactMutationResponse() {
  return NextResponse.json(
    { error: 'Cannot edit a submitted document' },
    { status: 409 }
  )
}

async function compensateUploadedArtifact(input: {
  supabase: ReturnType<typeof getServiceRoleClient>
  storagePath: string
  provisionalCleanup: ProvisionalAssignmentArtifactStorageCleanup | null
}): Promise<void> {
  const isReferenced = await assignmentArtifactStoragePathIsReferenced(input)
  if (isReferenced === true) {
    if (input.provisionalCleanup) {
      await adoptProvisionalAssignmentArtifactStorageCleanup({
        supabase: input.supabase,
        cleanup: input.provisionalCleanup,
      })
    }
    return
  }
  if (isReferenced === null) {
    if (!input.provisionalCleanup) {
      await enqueueAssignmentArtifactStorageCleanupPath({
        supabase: input.supabase,
        storagePath: input.storagePath,
      })
    }
    return
  }

  let removed = false
  try {
    const removal = await input.supabase.storage
      .from(ASSIGNMENT_ARTIFACTS_BUCKET)
      .remove([input.storagePath])
    removed = !removal.error
  } catch {
    removed = false
  }

  if (removed && input.provisionalCleanup) {
    await adoptProvisionalAssignmentArtifactStorageCleanup({
      supabase: input.supabase,
      cleanup: input.provisionalCleanup,
    })
    return
  }

  if (!removed && !input.provisionalCleanup) {
    await enqueueAssignmentArtifactStorageCleanupPath({
      supabase: input.supabase,
      storagePath: input.storagePath,
    })
  }
}

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
  const body = assignmentArtifactPutRequestSchema.parse(await request.json())
  const result = await loadStudentAssignmentContext({ assignmentId, requirementId, studentId: user.id })
  if (result.kind === 'response') return result.response

  const { requirement, supabase, doc } = result
  if (requirement.type === 'image') {
    return NextResponse.json({ error: 'Use image upload for image attachments.' }, { status: 400 })
  }

  const url = body.url
  const identity = requirement.type === 'repo_link'
    ? await loadUserGitHubIdentity(supabase, user.id)
    : null
  const githubLogin = requirement.type === 'repo_link'
    ? normalizeGitHubLogin(body.github_login ?? identity?.github_login)
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
    if (isSubmittedArtifactMutationError(error)) {
      return submittedArtifactMutationResponse()
    }
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
    return NextResponse.json({ error: 'Image upload is only available for image attachments.' }, { status: 400 })
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

  const { data: previousArtifact, error: previousArtifactError } = await supabase
    .from('assignment_submission_artifacts')
    .select('id, storage_path')
    .eq('assignment_doc_id', doc.id)
    .eq('requirement_id', requirement.id)
    .maybeSingle()
  if (previousArtifactError) {
    throw new Error('Failed to load the previous image artifact')
  }

  const ext = file.name.split('.').pop() || 'png'
  const objectId = crypto.randomUUID()
  const storagePath = `${user.id}/${assignmentId}/${requirement.id}-${Date.now()}-${objectId}.${ext}`
  const { data: assignmentOwner, error: assignmentOwnerError } = await supabase
    .from('assignments')
    .select('classroom_id')
    .eq('id', assignmentId)
    .single()
  if (assignmentOwnerError || !assignmentOwner) {
    throw new Error('Failed to resolve assignment file ownership')
  }
  const managedStoragePath = `classrooms/${assignmentOwner.classroom_id}/students/${user.id}/assignment-docs/${doc.id}/artifacts/${objectId}.${ext}`
  const reservation = await reserveManagedStorageUpload({
    supabase,
    objectId,
    bucket: ASSIGNMENT_ARTIFACTS_BUCKET,
    path: managedStoragePath,
    classroomId: assignmentOwner.classroom_id,
    purpose: 'student_assignment_artifact',
    createdByUserId: user.id,
    dataSubjectUserId: user.id,
    resourceType: 'assignment_doc',
    resourceId: doc.id,
    contentType: file.type,
    byteSize: file.size,
    allowLegacyCompatibility: true,
  })
  const effectiveStoragePath = reservation ? managedStoragePath : storagePath
  const provisionalCleanup = reservation
    ? null
    : await createProvisionalAssignmentArtifactStorageCleanup({
        supabase,
        storagePath: effectiveStoragePath,
      })
  if (!reservation && !provisionalCleanup) {
    throw new Error('Failed to protect image upload with durable cleanup evidence')
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const { error: uploadError } = await supabase.storage
    .from(ASSIGNMENT_ARTIFACTS_BUCKET)
    .upload(effectiveStoragePath, buffer, {
      contentType: file.type,
      upsert: false,
    })

  if (uploadError) {
    if (reservation) {
      await queueManagedStorageCleanupBestEffort({
        supabase,
        objectId,
        errorCode: 'assignment_artifact_upload_failed',
      })
    }
    throw new Error('Failed to upload image')
  }

  if (reservation) {
    try {
      await verifyManagedStorageUpload({ supabase, objectId })
    } catch (verificationError) {
      await queueManagedStorageCleanupBestEffort({
        supabase,
        objectId,
        errorCode: 'assignment_artifact_verification_failed',
      })
      throw verificationError
    }
  }

  let artifact: unknown = null
  let error: unknown = null
  try {
    const signed = await supabase.storage
      .from(ASSIGNMENT_ARTIFACTS_BUCKET)
      .createSignedUrl(effectiveStoragePath, SIGNED_IMAGE_URL_EXPIRES_SECONDS)
    const signedUrl = signed.data?.signedUrl ?? null

    const validation = await validateAssignmentSubmissionArtifactValue({
      type: 'image',
      storagePath: effectiveStoragePath,
      url: signedUrl,
    })

    const artifactWrite = {
      assignment_doc_id: doc.id,
      requirement_id: requirement.id,
      student_id: user.id,
      type: requirement.type,
      url: null,
      storage_path: effectiveStoragePath,
      metadata_json: {
        file_name: file.name,
        file_size: file.size,
        content_type: file.type,
      },
      validation_status: validation.validation_status,
      validation_message: validation.validation_message,
      validated_at: new Date().toISOString(),
      ...(reservation ? { managed_object_id: objectId } : {}),
    }
    const save = await supabase
      .from('assignment_submission_artifacts')
      .upsert(artifactWrite as any, { onConflict: 'assignment_doc_id,requirement_id' })
      .select('*')
      .single()
    artifact = save.data
    error = save.error
  } catch (saveError) {
    if (reservation) {
      await queueManagedStorageCleanupBestEffort({
        supabase,
        objectId,
        errorCode: 'assignment_artifact_attachment_failed',
      })
    } else {
      await compensateUploadedArtifact({
        supabase,
        storagePath: effectiveStoragePath,
        provisionalCleanup,
      })
    }
    throw saveError
  }

  if (error || !artifact) {
    if (reservation) {
      await queueManagedStorageCleanupBestEffort({
        supabase,
        objectId,
        errorCode: 'assignment_artifact_attachment_failed',
      })
    } else {
      await compensateUploadedArtifact({
        supabase,
        storagePath: effectiveStoragePath,
        provisionalCleanup,
      })
    }

    if (isSubmittedArtifactMutationError(error)) {
      return submittedArtifactMutationResponse()
    }
    if (isMissingAssignmentSubmissionSchemaError(error)) {
      return NextResponse.json({ error: 'Submission artifacts are not available yet.' }, { status: 503 })
    }
    throw new Error('Failed to save image artifact')
  }

  if (provisionalCleanup) {
    await adoptProvisionalAssignmentArtifactStorageCleanup({
      supabase,
      cleanup: provisionalCleanup,
    })
  }

  if (previousArtifact?.storage_path && previousArtifact.storage_path !== effectiveStoragePath) {
    await removeQueuedAssignmentArtifactStoragePath({
      supabase,
      storagePath: previousArtifact.storage_path,
    })
  }

  return NextResponse.json({ artifact: await withSignedImageUrl(supabase, artifact as AssignmentSubmissionArtifact) })
})

export const DELETE = withErrorHandler('DeleteAssignmentSubmissionArtifact', async (request, context) => {
  const user = await requireRole('student')
  const { id: assignmentId, requirementId } = await context.params
  const result = await loadStudentAssignmentContext({ assignmentId, requirementId, studentId: user.id })
  if (result.kind === 'response') return result.response

  const { supabase } = result
  const deletion = await deleteAssignmentSubmissionArtifactAtomic({
    supabase,
    assignmentId,
    studentId: user.id,
    requirementId,
  })
  if (!deletion.ok) {
    return NextResponse.json({ error: deletion.error }, { status: deletion.status })
  }

  const cleanup = deletion.storagePath
    ? await removeQueuedAssignmentArtifactStoragePath({
        supabase,
        storagePath: deletion.storagePath,
      })
    : { completed: true }

  return NextResponse.json(
    { ok: true, cleanup_pending: !cleanup.completed },
    { status: cleanup.completed ? 200 : 202 }
  )
})
