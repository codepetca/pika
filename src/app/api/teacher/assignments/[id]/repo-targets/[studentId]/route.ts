import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler, apiErrors } from '@/lib/api-handler'
import {
  extractRepoArtifactsFromContent,
  loadAssignmentRepoTarget,
  saveAssignmentRepoTarget,
  validatePublicGitHubRepo,
} from '@/lib/server/assignment-repo-targets'
import { assertTeacherOwnsAssignment } from '@/lib/server/repo-review'
import { getServiceRoleClient } from '@/lib/supabase'
import { parseContentField } from '@/lib/tiptap-content'

export const PUT = withErrorHandler('PutTeacherAssignmentRepoTarget', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: assignmentId, studentId } = await context.params
  await assertTeacherOwnsAssignment(user.id, assignmentId)

  const body = await request.json()
  const selectionMode = body.selection_mode === 'teacher_override' ? 'teacher_override'
    : body.selection_mode === 'teacher_selected' ? 'teacher_selected'
    : 'auto'
  const selectedRepoUrl = typeof body.selected_repo_url === 'string' ? body.selected_repo_url.trim() : ''
  const githubLogin = typeof body.github_login === 'string' ? body.github_login.trim() : null
  const commitEmails = Array.isArray(body.commit_emails)
    ? body.commit_emails
    : typeof body.commit_emails === 'string'
      ? body.commit_emails.split(',').map((value: string) => value.trim()).filter(Boolean)
      : []

  const supabase = getServiceRoleClient()

  const { data: existingDoc } = await supabase
    .from('assignment_docs')
    .select('content')
    .eq('assignment_id', assignmentId)
    .eq('student_id', studentId)
    .maybeSingle()

  const candidateRepos = existingDoc
    ? extractRepoArtifactsFromContent(parseContentField(existingDoc.content))
    : []

  let repoTarget = await loadAssignmentRepoTarget(assignmentId, studentId)
  if (selectionMode === 'auto' && !selectedRepoUrl) {
    if (repoTarget?.id) {
      await supabase
        .from('assignment_repo_targets')
        .delete()
        .eq('id', repoTarget.id)
      repoTarget = null
    }
  } else {
    if (!selectedRepoUrl) {
      throw apiErrors.badRequest('selected_repo_url is required when saving a repo target')
    }

    const validation = await validatePublicGitHubRepo(selectedRepoUrl)
    repoTarget = await saveAssignmentRepoTarget({
      assignmentId,
      studentId,
      repoUrl: validation.repoUrl,
      selectionMode,
      validationStatus: validation.validationStatus,
      validationMessage: validation.validationMessage,
      repoOwner: validation.repoOwner || null,
      repoName: validation.repoName || null,
    })
  }

  if (githubLogin || commitEmails.length > 0) {
    const { error } = await supabase
      .from('user_github_identities')
      .upsert({
        user_id: studentId,
        github_login: githubLogin || null,
        commit_emails: commitEmails,
      }, { onConflict: 'user_id' })

    if (error) {
      throw new Error('Failed to save GitHub identity')
    }
  } else if (body.clear_identity === true) {
    await supabase
      .from('user_github_identities')
      .delete()
      .eq('user_id', studentId)
  }

  return NextResponse.json({
    repo_target: repoTarget,
    candidate_repos: candidateRepos,
  })
})
