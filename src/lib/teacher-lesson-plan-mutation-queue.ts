const classroomMutationTails = new Map<string, Promise<void>>()

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
}
