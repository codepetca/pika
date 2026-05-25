import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import {
  normalizeGitHubLogin,
  validateGitHubLogin,
} from '@/lib/server/assignment-submission-validation'
import {
  isMissingAssignmentSubmissionSchemaError,
  loadUserGitHubIdentity,
} from '@/lib/server/assignment-submission-artifacts'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetAccountGithubIdentity', async () => {
  const user = await requireAuth()
  const supabase = getServiceRoleClient()
  const identity = await loadUserGitHubIdentity(supabase, user.id)

  return NextResponse.json({ identity })
})

export const PATCH = withErrorHandler('PatchAccountGithubIdentity', async (request: NextRequest) => {
  const user = await requireAuth()
  const body = await request.json()
  const githubLogin = normalizeGitHubLogin(typeof body.github_login === 'string' ? body.github_login : null)

  if (!githubLogin) {
    return NextResponse.json({ error: 'Enter a valid GitHub username.' }, { status: 400 })
  }

  const validation = await validateGitHubLogin(githubLogin)
  const now = new Date().toISOString()
  const supabase = getServiceRoleClient()
  const { data, error } = await supabase
    .from('user_github_identities')
    .upsert({
      user_id: user.id,
      github_login: githubLogin,
      validation_status: validation.validation_status,
      validation_message: validation.validation_message,
      validated_at: now,
    }, { onConflict: 'user_id' })
    .select('*')
    .single()

  if (error) {
    if (isMissingAssignmentSubmissionSchemaError(error)) {
      return NextResponse.json({ error: 'GitHub identity storage is not available yet.' }, { status: 503 })
    }
    throw new Error('Failed to save GitHub identity')
  }

  return NextResponse.json({ identity: data })
})
