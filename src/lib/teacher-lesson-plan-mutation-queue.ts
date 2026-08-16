import { safeSessionGetJson, safeSessionRemove, safeSessionSetJson } from '@/lib/client-storage'

const classroomMutationTails = new Map<string, Promise<void>>()
const MUTATION_SESSION_STORAGE_KEY = 'pika:lesson-plan-mutation-session'

export type TeacherLessonPlanMutationVersion = {
  client_id: string
  sequence: number
}

let fallbackMutationVersion: TeacherLessonPlanMutationVersion | null = null

function createMutationVersion(): TeacherLessonPlanMutationVersion {
  return { client_id: globalThis.crypto.randomUUID(), sequence: 0 }
}

function readMutationVersion(): TeacherLessonPlanMutationVersion {
  if (typeof window === 'undefined') {
    fallbackMutationVersion ??= createMutationVersion()
    return fallbackMutationVersion
  }

  if (fallbackMutationVersion) return fallbackMutationVersion
  const parsed = safeSessionGetJson<Partial<TeacherLessonPlanMutationVersion>>(
    MUTATION_SESSION_STORAGE_KEY,
  )
  if (
    typeof parsed?.client_id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.client_id) &&
    typeof parsed.sequence === 'number' &&
    Number.isSafeInteger(parsed.sequence) &&
    parsed.sequence >= 0
  ) {
    return { client_id: parsed.client_id, sequence: parsed.sequence }
  }

  const created = createMutationVersion()
  if (!safeSessionSetJson(MUTATION_SESSION_STORAGE_KEY, created)) {
    fallbackMutationVersion = created
  }
  return created
}

export function allocateTeacherLessonPlanMutationVersion(): TeacherLessonPlanMutationVersion {
  const current = readMutationVersion()
  const next = { ...current, sequence: current.sequence + 1 }

  if (typeof window === 'undefined') {
    fallbackMutationVersion = next
  } else if (!safeSessionSetJson(MUTATION_SESSION_STORAGE_KEY, next)) {
    fallbackMutationVersion = next
  }

  return next
}

/**
 * Serializes lesson-plan mutations for a classroom, including across Calendar
 * component remounts. A rejected mutation does not block later queued work.
 */
export function enqueueTeacherLessonPlanMutation<T>(
  classroomId: string,
  mutation: () => Promise<T>,
): Promise<T> {
  const previous = classroomMutationTails.get(classroomId) ?? Promise.resolve()
  const result = previous.catch(() => undefined).then(mutation)
  const tail = result.then(
    () => undefined,
    () => undefined,
  )

  classroomMutationTails.set(classroomId, tail)
  void tail.then(() => {
    if (classroomMutationTails.get(classroomId) === tail) {
      classroomMutationTails.delete(classroomId)
    }
  })

  return result
}

export function resetTeacherLessonPlanMutationQueuesForTests(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Lesson-plan mutation queues can only be reset in tests')
  }
  classroomMutationTails.clear()
  fallbackMutationVersion = null
  safeSessionRemove(MUTATION_SESSION_STORAGE_KEY)
}
