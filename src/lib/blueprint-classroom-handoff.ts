const OVERFLOW_STORAGE_PREFIX = 'pika:blueprint-classroom-overflow:'

function storageKey(classroomId: string) {
  return `${OVERFLOW_STORAGE_PREFIX}${classroomId}`
}

export function storeBlueprintClassroomOverflow(classroomId: string, value: unknown) {
  try {
    const lessonTitles = Array.isArray(value)
      ? value.filter((title): title is string => typeof title === 'string' && title.length > 0)
      : []
    if (lessonTitles.length === 0) {
      window.sessionStorage.removeItem(storageKey(classroomId))
      return
    }
    window.sessionStorage.setItem(storageKey(classroomId), JSON.stringify(lessonTitles))
  } catch {
    // The classroom still opens with the generic class-day review prompt when
    // browser storage is unavailable.
  }
}

export function readBlueprintClassroomOverflow(classroomId: string) {
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(storageKey(classroomId)) || '[]')
    return Array.isArray(value)
      ? value.filter((title): title is string => typeof title === 'string' && title.length > 0)
      : []
  } catch {
    return []
  }
}

export function clearBlueprintClassroomOverflow(classroomId: string) {
  try {
    window.sessionStorage.removeItem(storageKey(classroomId))
  } catch {
    // The URL state is still cleared when browser storage is unavailable.
  }
}
