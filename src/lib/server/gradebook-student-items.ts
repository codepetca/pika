import { ApiError } from '@/lib/api-error'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'
import type { ReturnedGradebookItem } from '@/lib/gradebook-student-items'

export async function getStudentReturnedGradebookItems(
  studentId: string,
  classroomId: string,
): Promise<ReturnedGradebookItem[]> {
  const access = await assertStudentCanAccessClassroom(studentId, classroomId)
  if (!access.ok) throw new ApiError(access.status, access.error)
  if (!access.classroom.feature_visibility.classwork) {
    throw new ApiError(403, 'Classwork is hidden in this classroom')
  }

  const supabase = getServiceRoleClient()
  const items: ReturnedGradebookItem[] = []
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    // Each joined read keeps released scores and item details in the same snapshot.
    // Identity and release filtering happen here, never in the browser.
    const { data, error } = await supabase
      .from('gradebook_item_scores')
      .select('earned, gradebook_items!inner(id, classroom_id, title, points_possible, include_in_final, gradebook_categories(name, percentage))')
      .eq('classroom_id', classroomId)
      .eq('student_id', studentId)
      .eq('gradebook_items.classroom_id', classroomId)
      .not('returned_at', 'is', null)
      .not('earned', 'is', null)
      .order('returned_at', { ascending: false })
      .order('item_id', { ascending: true })
      .range(offset, offset + pageSize - 1)

    if (error) {
      // The new tables may not exist yet during the human-controlled rollout.
      if (error.code === '42P01' || error.code === 'PGRST205') return []
      throw new ApiError(500, 'Could not load returned marks')
    }

    items.push(...(data ?? []).map(score => {
      const item = score.gradebook_items
      return {
        id: item.id,
        title: item.title,
        earned: score.earned,
        possible: item.points_possible,
        percent: Math.round((score.earned / item.points_possible) * 10_000) / 100,
        categoryName: item.gradebook_categories?.name ?? null,
        included: item.include_in_final && (item.gradebook_categories?.percentage ?? 0) > 0,
      }
    }))
    if ((data?.length ?? 0) < pageSize) return items
  }
}
