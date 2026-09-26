import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { maximumStateMap } from '@/lib/gradebook-maximum'
import { getServiceRoleClient } from '@/lib/supabase'
import type { Database } from '@/types/database'
import type { GradebookMaximumPut } from '@/lib/validations/gradebook-maximum'

const stateSchema = z.array(z.object({
  assessment_type: z.enum(['assignment', 'test', 'item']), assessment_id: z.string(),
  maximum: z.number().finite().positive().nullable(), score_scale: z.number().finite().positive(),
}))

type MaximumRpcName = 'read_gradebook_maximum_state' | 'set_gradebook_maximum_override' | 'save_gradebook_effective_mark'
type MaximumRpcArgs = Database['public']['Functions'][MaximumRpcName]['Args']
async function maximumRpc(name: MaximumRpcName, args: MaximumRpcArgs) {
  const client = getServiceRoleClient()
  if (typeof client.rpc !== 'function') return { data: null, error: { code: 'PGRST202' } }
  return (await client.rpc(name, args)) ?? { data: null, error: { code: 'PGRST202' } }
}
export function isGradebookMaximumEditingEnabled() {
  return process.env.NODE_ENV !== 'production' || process.env.GRADEBOOK_MAXIMUM_EDITS_ENABLED === 'true'
}
function missing(error: { code?: string } | null) { return ['PGRST202', '42883'].includes(error?.code ?? '') }
function assertResult(error: { code?: string } | null) {
  if (!error) return
  if (missing(error)) throw new ApiError(409, 'Maximum overrides require the database update')
  if (error.code === '22003') throw new ApiError(400, 'This change exceeds the supported mark range. Restore the original maximum and try again')
  if (error.code === '42501') throw new ApiError(403, 'You cannot edit this classroom')
  if (error.code === '55000') throw new ApiError(409, 'This classroom is archived')
  if (error.code === '40001') throw new ApiError(409, 'This maximum changed. Refresh the Gradebook and try again')
  if (error.code === 'P0002') throw new ApiError(404, 'Assessment or enrolled student not found')
  if (error.code === '22023' || error.code === '23514') throw new ApiError(400, 'Invalid maximum or mark')
  throw new ApiError(500, 'Could not save Gradebook changes')
}
export async function loadGradebookMaximumState(classroomId: string) {
  const { data, error } = await maximumRpc('read_gradebook_maximum_state', { p_classroom_id: classroomId })
  if (missing(error)) return { available: false, states: maximumStateMap([]) }
  if (error) throw new ApiError(500, 'Could not load Gradebook maximums')
  // Empty mock/old adapter responses are unavailable, never permission to write.
  if (data == null) return { available: false, states: maximumStateMap([]) }
  const states = stateSchema.safeParse(data)
  if (!states.success) throw new ApiError(500, 'Invalid Gradebook maximum data')
  return { available: true, states: maximumStateMap(states.data) }
}
export async function saveGradebookMaximum(teacherId: string, command: GradebookMaximumPut) {
  if (command.mode !== 'reset' && !isGradebookMaximumEditingEnabled()) {
    throw new ApiError(409, 'Maximum edits are not enabled on this deployment')
  }
  const { error } = await maximumRpc('set_gradebook_maximum_override', {
    p_teacher_id: teacherId, p_classroom_id: command.classroom_id,
    p_assessment_type: command.assessment_type, p_assessment_id: command.assessment_id,
    p_maximum: command.maximum, p_mode: command.mode,
    p_expected_maximum: command.expected_maximum, p_expected_scale: command.expected_scale,
  })
  assertResult(error)
  return { saved: true }
}
export async function saveEffectiveGradebookMark(teacherId: string, classroomId: string, type: 'assignment' | 'test' | 'item', assessmentId: string, studentId: string, earned: number | null) {
  const { error } = await maximumRpc('save_gradebook_effective_mark', {
    p_teacher_id: teacherId, p_classroom_id: classroomId, p_assessment_type: type,
    p_assessment_id: assessmentId, p_student_id: studentId, p_earned: earned,
  })
  assertResult(error)
  return { saved: true }
}
