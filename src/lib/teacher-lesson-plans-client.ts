import type { LessonPlan } from '@/types'
import { fetchJSONWithCache, invalidateCachedJSONMatching } from '@/lib/request-cache'

type TeacherLessonPlansResponse = {
  lesson_plans?: LessonPlan[]
  lessonPlans?: LessonPlan[]
}

const TEACHER_LESSON_PLANS_CACHE_TTL_MS = 20_000

export function getTeacherLessonPlansCachePrefix(classroomId: string): string {
  return `teacher-lesson-plans:${classroomId}:`
}

export function getTeacherLessonPlansCacheKey(classroomId: string, start: string, end: string): string {
  return `${getTeacherLessonPlansCachePrefix(classroomId)}${start}:${end}`
}

export async function fetchTeacherLessonPlansForRange(
  classroomId: string,
  start: string,
  end: string,
): Promise<LessonPlan[]> {
  const data = await fetchJSONWithCache<TeacherLessonPlansResponse>(
    getTeacherLessonPlansCacheKey(classroomId, start, end),
    async () => {
      const response = await fetch(
        `/api/teacher/classrooms/${classroomId}/lesson-plans?start=${start}&end=${end}`,
      )
      let data: TeacherLessonPlansResponse & { error?: unknown }
      try {
        data = await response.json()
      } catch {
        if (!response.ok) {
          data = {}
        } else {
          throw new Error('Failed to parse lesson plans response')
        }
      }
      if (!response.ok) {
        let message = `Failed to load lesson plans (${response.status})`
        if (response.status === 401 || response.status === 403) {
          message = 'Not authorized to view lesson plans'
        } else if (response.status === 404) {
          message = 'Classroom not found'
        } else if (typeof data.error === 'string') {
          message = data.error
        }
        throw new Error(message)
      }
      return data
    },
    TEACHER_LESSON_PLANS_CACHE_TTL_MS,
  )

  return data.lesson_plans || data.lessonPlans || []
}

export function invalidateTeacherLessonPlansForClassroom(classroomId: string) {
  invalidateCachedJSONMatching(getTeacherLessonPlansCachePrefix(classroomId))
}
