import { z } from 'zod'

import { ApiError } from '@/lib/api-error'
import { isRetryableDatabaseContention } from '@/lib/server/database-contention'
import type { AssignmentRepoTarget, AssignmentRepoTargetSelectionMode, AssignmentRepoTargetValidationStatus } from '@/types'
import type { Json } from '@/types/database.generated'

const canonicalUuid = z.string().uuid().transform((value) => value.toLowerCase())
const timestamp = z.string().datetime({ offset: true })
const repoTargetSchema = z.object({
  id: canonicalUuid,
  assignment_id: canonicalUuid,
  student_id: canonicalUuid,
  selected_repo_url: z.string().nullable(),
  override_github_username: z.string().nullable(),
  repo_owner: z.string().nullable(),
  repo_name: z.string().nullable(),
  selection_mode: z.enum(['auto', 'teacher_override']),
  validation_status: z.enum(['missing', 'ambiguous', 'valid', 'invalid', 'private', 'inaccessible']),
  validation_message: z.string().nullable(),
  validated_at: timestamp.nullable(),
  created_at: timestamp,
  updated_at: timestamp,
}).passthrough()
const resultSchema = z.object({
  ok: z.literal(true),
  actor_id: canonicalUuid,
  assignment_id: canonicalUuid,
  student_id: canonicalUuid,
  repo_target: repoTargetSchema.nullable(),
}).strict()

type RpcError = { code?: string; message?: string }
type RepoTargetClient = {
  rpc: (
    name: 'save_assignment_repo_target_for_owner_v1',
    args: {
      p_actor_id: string
      p_assignment_id: string
      p_student_id: string
      p_target: Json | null
      p_now: string
    },
  ) => PromiseLike<{ data: unknown; error: RpcError | null }>
}

export type ContextualAssignmentRepoTargetInput = {
  selectedRepoUrl: string | null
  overrideGitHubUsername: string | null
  repoOwner: string | null
  repoName: string | null
  selectionMode: AssignmentRepoTargetSelectionMode
  validationStatus: AssignmentRepoTargetValidationStatus
  validationMessage: string | null
}

function mapRpcError(error: RpcError): never {
  if (error.code === 'P0002') throw new ApiError(404, 'Assignment not found')
  if (error.code === '42501') throw new ApiError(403, 'Unauthorized')
  if (error.code === '55000' && error.message === 'assignment_repo_target_archived') {
    throw new ApiError(403, 'Classroom is archived')
  }
  if (error.code === '40001' || isRetryableDatabaseContention(error)) {
    throw new ApiError(409, 'Classroom changed during this update. Refresh and try again.')
  }
  if (error.code === '22023' || error.code === '22P02') {
    throw new ApiError(400, error.message ?? 'Invalid assignment repo target request')
  }
  throw new ApiError(503, 'Unable to save assignment repo target')
}

export async function saveAssignmentRepoTargetForOwner(input: {
  supabase: RepoTargetClient
  actorId: string
  assignmentId: string
  studentId: string
  target: ContextualAssignmentRepoTargetInput | null
}): Promise<AssignmentRepoTarget | null> {
  const actor = canonicalUuid.safeParse(input.actorId)
  const assignment = canonicalUuid.safeParse(input.assignmentId)
  const student = canonicalUuid.safeParse(input.studentId)
  if (!actor.success || !assignment.success || !student.success) {
    throw new ApiError(400, 'Invalid assignment repo target request')
  }

  const target = input.target === null ? null : {
    selected_repo_url: input.target.selectedRepoUrl,
    override_github_username: input.target.overrideGitHubUsername,
    repo_owner: input.target.repoOwner,
    repo_name: input.target.repoName,
    selection_mode: input.target.selectionMode,
    validation_status: input.target.validationStatus,
    validation_message: input.target.validationMessage,
  }
  const now = new Date().toISOString()
  const { data, error } = await input.supabase.rpc('save_assignment_repo_target_for_owner_v1', {
    p_actor_id: actor.data,
    p_assignment_id: assignment.data,
    p_student_id: student.data,
    p_target: target,
    p_now: now,
  })
  if (error) mapRpcError(error)

  const parsed = resultSchema.safeParse(data)
  if (!parsed.success
    || parsed.data.actor_id !== actor.data
    || parsed.data.assignment_id !== assignment.data
    || parsed.data.student_id !== student.data
    || (input.target === null) !== (parsed.data.repo_target === null)
    || (parsed.data.repo_target !== null && (
      parsed.data.repo_target.assignment_id !== assignment.data
      || parsed.data.repo_target.student_id !== student.data
      || parsed.data.repo_target.selected_repo_url !== input.target?.selectedRepoUrl
      || parsed.data.repo_target.override_github_username !== input.target?.overrideGitHubUsername
      || parsed.data.repo_target.repo_owner !== input.target?.repoOwner
      || parsed.data.repo_target.repo_name !== input.target?.repoName
      || parsed.data.repo_target.selection_mode !== input.target?.selectionMode
      || parsed.data.repo_target.validation_status !== input.target?.validationStatus
      || parsed.data.repo_target.validation_message !== input.target?.validationMessage
      || parsed.data.repo_target.validated_at !== now
    ))
  ) {
    throw new ApiError(503, 'Unable to verify assignment repo target')
  }

  return parsed.data.repo_target as AssignmentRepoTarget | null
}
