import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler, apiErrors } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherOwnsAssignment, parseAndValidateRepoUrl } from '@/lib/server/repo-review'
import { repoReviewConfigSchema } from '@/lib/validations/repo-review'

export const PUT = withErrorHandler('UpdateTeacherAssignmentRepoReviewConfig', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const assignment = await assertTeacherOwnsAssignment(user.id, id)

  if (assignment.classrooms.archived_at) {
    throw apiErrors.badRequest('Classroom is archived')
  }

  const body = repoReviewConfigSchema.parse(await request.json())
  const repo = parseAndValidateRepoUrl(body.repo_url)
  const supabase = getServiceRoleClient()

  const { error: assignmentError } = await supabase
    .from('assignments')
    .update({ evaluation_mode: 'repo_review' })
    .eq('id', id)

  if (assignmentError) {
    throw apiErrors.conflict('Failed to update assignment mode')
  }

  const { data: config, error: configError } = await supabase
    .from('assignment_repo_reviews')
    .upsert({
      assignment_id: id,
      provider: 'github',
      repo_owner: repo.owner,
      repo_name: repo.name,
      default_branch: body.default_branch,
      review_start_at: body.review_start_at ?? null,
      review_end_at: body.review_end_at ?? null,
      include_pr_reviews: body.include_pr_reviews,
      config_json: {
        metrics_version: 'v1',
        prompt_version: 'v1',
      },
    }, { onConflict: 'assignment_id' })
    .select()
    .single()

  if (configError || !config) {
    throw apiErrors.conflict('Failed to save repo review config')
  }

  const rowsToUpsert = body.student_mappings
    .filter((mapping) => mapping.github_login || mapping.commit_emails.length > 0)
    .map((mapping) => ({
      user_id: mapping.student_id,
      github_login: mapping.github_login?.trim() || null,
      commit_emails: mapping.commit_emails,
    }))

  if (rowsToUpsert.length > 0) {
    const { error: identityError } = await supabase
      .from('user_github_identities')
      .upsert(rowsToUpsert, { onConflict: 'user_id' })
    if (identityError) {
      throw apiErrors.conflict('Failed to save GitHub identities')
    }
  }

  const rowsToDelete = body.student_mappings
    .filter((mapping) => !mapping.github_login && mapping.commit_emails.length === 0)
    .map((mapping) => mapping.student_id)

  if (rowsToDelete.length > 0) {
    await supabase
      .from('user_github_identities')
      .delete()
      .in('user_id', rowsToDelete)
  }

  return NextResponse.json({ config })
})
