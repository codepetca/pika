import { buildOrderedClassworkItems, placeCreatedClasswork } from '@/lib/classwork-order'
import { fetchCachedJSON, fetchJSON, invalidateCachedJSON } from '@/lib/request-cache'
import type { Assignment, ClassworkMaterial, Survey } from '@/types'

export function invalidateClassworkLists(classroomId: string) {
  for (const role of ['teacher', 'student']) {
    for (const kind of ['assignments', 'materials', 'surveys']) {
      invalidateCachedJSON(`${role}-${kind}:${classroomId}`)
    }
  }
}

/** Creation has already succeeded. A failed positioning request must never retry creation. */
export async function saveCreatedClassworkPlacement(
  classroomId: string,
  created: { type: 'assignment' | 'material' | 'survey'; id: string },
) {
  invalidateClassworkLists(classroomId)
  try {
    const [assignments, materials, surveys] = await Promise.all([
      fetchCachedJSON<{ assignments: Assignment[] }>(
        `teacher-assignments:${classroomId}`,
        `/api/teacher/assignments?classroom_id=${classroomId}`, { ttlMs: 0 },
      ),
      fetchCachedJSON<{ materials: ClassworkMaterial[] }>(
        `teacher-materials:${classroomId}`,
        `/api/teacher/classrooms/${classroomId}/materials`, { ttlMs: 0 },
      ),
      fetchCachedJSON<{ surveys: Survey[] }>(
        `teacher-surveys:${classroomId}`,
        `/api/teacher/surveys?classroom_id=${classroomId}`, { ttlMs: 0 },
      ),
    ])
    const items = buildOrderedClassworkItems(assignments.assignments, materials.materials, surveys.surveys)
    const reordered = placeCreatedClasswork(items, created)
    if (items.every((item, index) => item === reordered[index])) return
    await fetchJSON(`/api/teacher/classrooms/${classroomId}/classwork/reorder`, {
      init: {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: reordered.map(({ type, id }) => ({ type, id })) }),
      },
      errorMessage: 'Failed to save classwork order',
    })
  } finally {
    invalidateClassworkLists(classroomId)
  }
}
