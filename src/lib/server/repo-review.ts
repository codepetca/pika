import { getServiceRoleClient } from '@/lib/supabase'
import { parseGitHubRepoUrl } from '@/lib/repo-review'
import { ApiError, apiErrors } from '@/lib/api-handler'
import type {
  Assignment,
  AssignmentRepoReviewConfig,
  AssignmentRepoReviewResult,
  AssignmentRepoReviewRun,
  UserGitHubIdentity,
} from '@/types'

type AssignmentWithClassroom = Assignment & {
  classrooms: {
    id: string
    title: string
    teacher_id: string
    archived_at: string | null
  }
}

export interface RepoReviewRosterStudent {
  student_id: string
  student_email: string
  student_name: string | null
  github_identity: UserGitHubIdentity | null
}

export async function assertTeacherOwnsAssignment(teacherId: string, assignmentId: string): Promise<AssignmentWithClassroom> {
  const supabase = getServiceRoleClient()
  const { data, error } = await supabase
    .from('assignments')
    .select(`
      *,
      classrooms!inner (
        id,
        title,
        teacher_id,
        archived_at
      )
    `)
    .eq('id', assignmentId)
    .single()

  if (error || !data) {
    throw apiErrors.notFound('Assignment not found')
  }

  if (data.classrooms.teacher_id !== teacherId) {
    throw new ApiError(403, 'Unauthorized')
  }

  return data as AssignmentWithClassroom
}

export async function loadRepoReviewConfig(assignmentId: string): Promise<AssignmentRepoReviewConfig | null> {
  const supabase = getServiceRoleClient()
  const { data, error } = await supabase
    .from('assignment_repo_reviews')
    .select('*')
    .eq('assignment_id', assignmentId)
    .maybeSingle()

  if (error) {
    throw new ApiError(500, 'Failed to load repo review config')
  }

  return data as AssignmentRepoReviewConfig | null
}

export async function loadRepoReviewRosterStudents(classroomId: string): Promise<RepoReviewRosterStudent[]> {
  const supabase = getServiceRoleClient()
  const { data: enrollments, error: enrollmentsError } = await supabase
    .from('classroom_enrollments')
    .select(`
      student_id,
      users!inner (
        email
      )
    `)
    .eq('classroom_id', classroomId)

  if (enrollmentsError) {
    throw new ApiError(500, 'Failed to load classroom roster')
  }

  const studentIds = (enrollments || []).map((row) => row.student_id)
  const { data: profiles } = studentIds.length > 0
    ? await supabase
        .from('student_profiles')
        .select('user_id, first_name, last_name')
        .in('user_id', studentIds)
    : { data: [] as Array<{ user_id: string; first_name: string | null; last_name: string | null }> }

  const { data: githubIdentities } = studentIds.length > 0
    ? await supabase
        .from('user_github_identities')
        .select('*')
        .in('user_id', studentIds)
    : { data: [] as UserGitHubIdentity[] }

  const profileMap = new Map(
    (profiles || []).map((profile) => [
      profile.user_id,
      `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || null,
    ])
  )
  const identityMap = new Map(
    (githubIdentities || []).map((identity) => [identity.user_id, identity as UserGitHubIdentity])
  )

  return (enrollments || [])
    .map((row) => ({
      student_id: row.student_id,
      student_email: (row.users as unknown as { email: string }).email,
      student_name: profileMap.get(row.student_id) || null,
      github_identity: identityMap.get(row.student_id) || null,
    }))
    .sort((left, right) => (left.student_name || left.student_email).localeCompare(right.student_name || right.student_email))
}

export async function loadLatestRepoReviewRun(assignmentId: string): Promise<AssignmentRepoReviewRun | null> {
  const supabase = getServiceRoleClient()
  const { data, error } = await supabase
    .from('assignment_repo_review_runs')
    .select('*')
    .eq('assignment_id', assignmentId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new ApiError(500, 'Failed to load repo review run')
  }

  return data as AssignmentRepoReviewRun | null
}

export async function loadLatestCompletedRepoReviewRun(assignmentId: string): Promise<AssignmentRepoReviewRun | null> {
  const supabase = getServiceRoleClient()
  const { data, error } = await supabase
    .from('assignment_repo_review_runs')
    .select('*')
    .eq('assignment_id', assignmentId)
    .eq('status', 'completed')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new ApiError(500, 'Failed to load completed repo review run')
  }

  return data as AssignmentRepoReviewRun | null
}

export async function loadRepoReviewResults(runId: string): Promise<AssignmentRepoReviewResult[]> {
  const supabase = getServiceRoleClient()
  const { data, error } = await supabase
    .from('assignment_repo_review_results')
    .select('*')
    .eq('run_id', runId)

  if (error) {
    throw new ApiError(500, 'Failed to load repo review results')
  }

  return (data || []) as AssignmentRepoReviewResult[]
}

export function parseAndValidateRepoUrl(repoUrl: string): { owner: string; name: string } {
  const parsed = parseGitHubRepoUrl(repoUrl)
  if (!parsed) {
    throw apiErrors.badRequest('repo_url must be a GitHub URL or owner/name')
  }
  return parsed
}
