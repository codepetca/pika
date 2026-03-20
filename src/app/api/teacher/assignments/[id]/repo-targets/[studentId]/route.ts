import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler, apiErrors } from '@/lib/api-handler'
import {
  loadAssignmentRepoTarget,
  saveAssignmentRepoTarget,
  validatePublicGitHubRepo,
} from '@/lib/server/assignment-repo-targets'
import { assertTeacherOwnsAssignment } from '@/lib/server/repo-review'
import { getServiceRoleClient } from '@/lib/supabase'

export const PUT = withErrorHandler('PutTeacherAssignmentRepoTarget', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: assignmentId, studentId } = await context.params
  await assertTeacherOwnsAssignment(user.id, assignmentId)

  const body = await request.json()
  const selectionMode = body.selection_mode === 'teacher_override' ? 'teacher_override'
    : 'auto'
  const selectedRepoUrl = typeof body.selected_repo_url === 'string' ? body.selected_repo_url.trim() : ''
  const overrideGitHubUsername = typeof body.override_github_username === 'string'
    ? body.override_github_username.trim()
    : ''

  const supabase = getServiceRoleClient()

  const { data: existingDoc } = await supabase
    .from('assignment_docs')
    .select('repo_url, github_username')
    .eq('assignment_id', assignmentId)
    .eq('student_id', studentId)
    .maybeSingle()

  let repoTarget = await loadAssignmentRepoTarget(assignmentId, studentId)
  if (selectionMode === 'auto' && !selectedRepoUrl && !overrideGitHubUsername) {
    if (repoTarget?.id) {
      await supabase
        .from('assignment_repo_targets')
        .delete()
        .eq('id', repoTarget.id)
      repoTarget = null
    }
  } else {
    const submittedRepoUrl = existingDoc?.repo_url?.trim() || ''
    const repoUrlToValidate = selectedRepoUrl || submittedRepoUrl
    if (!repoUrlToValidate) {
      throw apiErrors.badRequest('selected_repo_url is required when saving a repo target')
    }

    const validation = await validatePublicGitHubRepo(repoUrlToValidate)
    repoTarget = await saveAssignmentRepoTarget({
      assignmentId,
      studentId,
      repoUrl: selectionMode === 'teacher_override' ? validation.repoUrl : null,
      overrideGitHubUsername: selectionMode === 'teacher_override' ? (overrideGitHubUsername || null) : null,
      selectionMode,
      validationStatus: validation.validationStatus,
      validationMessage: validation.validationMessage,
      repoOwner: validation.repoOwner || null,
      repoName: validation.repoName || null,
    })
  }

  return NextResponse.json({
    repo_target: repoTarget,
    submitted_repo_url: existingDoc?.repo_url || null,
    submitted_github_username: existingDoc?.github_username || null,
  })
})
