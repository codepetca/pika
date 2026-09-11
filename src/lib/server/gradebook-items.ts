import { ApiError } from '@/lib/api-error'
import { getServiceRoleClient } from '@/lib/supabase'
import type { GradebookItemMutation, GradebookItemScore } from '@/lib/validations/gradebook-items'

function assertMutationResult(error: { code?: string } | null) {
  if (!error) return
  if (error.code === '42501') throw new ApiError(403, 'You cannot edit this classroom')
  if (error.code === '55000') throw new ApiError(409, 'This classroom is archived or temporarily unavailable for changes')
  if (error.code === 'P0002') throw new ApiError(404, 'Item or enrolled student not found')
  if (error.code === '22023' || error.code === '23503' || error.code === '23514') throw new ApiError(400, 'Invalid item details or mark')
  if (error.code === '23505') throw new ApiError(409, 'This item changed. Refresh the Gradebook and try again')
  if (['42P01', 'PGRST202', 'PGRST205'].includes(error.code ?? '')) {
    throw new ApiError(409, 'Gradebook items are not available until the database update is applied')
  }
  throw new ApiError(500, 'Could not save the Gradebook item')
}

export async function mutateTeacherGradebookItem(teacherId: string, command: GradebookItemMutation) {
  const { data, error } = await getServiceRoleClient().rpc('mutate_gradebook_item', {
    p_teacher_id: teacherId,
    p_classroom_id: command.classroom_id,
    p_item_id: command.item_id,
    p_action: command.action,
    ...('title' in command ? {
      p_title: command.title,
      p_points_possible: command.points_possible,
      p_gradebook_category_id: command.gradebook_category_id,
      p_include_in_final: command.include_in_final,
    } : {}),
    ...('gradebook_weight' in command ? { p_gradebook_weight: command.gradebook_weight } : {}),
  })
  assertMutationResult(error)
  return data
}

export async function setTeacherGradebookItemScore(teacherId: string, command: GradebookItemScore) {
  const { data, error } = await getServiceRoleClient().rpc('set_gradebook_item_score', {
    p_teacher_id: teacherId,
    p_classroom_id: command.classroom_id,
    p_item_id: command.item_id,
    p_student_id: command.student_id,
    p_earned: command.earned,
  })
  assertMutationResult(error)
  return data
}
