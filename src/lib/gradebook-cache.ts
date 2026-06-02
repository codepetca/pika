import { invalidateCachedJSONMatching } from '@/lib/request-cache'

export function invalidateGradebookForClassroom(classroomId: string) {
  invalidateCachedJSONMatching(`gradebook:${classroomId}:`)
}
