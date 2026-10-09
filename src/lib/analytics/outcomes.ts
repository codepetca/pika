/** Diagnostic confirmation only; never changes application persistence behavior. */
function own(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor && 'value' in descriptor ? descriptor.value : undefined
}

export function isConfirmedAssignmentSave(value: unknown, owner: {
  classroomId: string
  assignmentId: string | null
}): boolean {
  try {
    const id = own(value, 'id')
    return typeof id === 'string' && id.length > 0
      && (owner.assignmentId === null || id === owner.assignmentId)
      && own(value, 'classroom_id') === owner.classroomId
      && typeof own(value, 'is_draft') === 'boolean'
  } catch { return false }
}

export function isConfirmedClassworkRead(assignments: unknown, materials: unknown, surveys: unknown, classroomId: string): boolean {
  try {
    return [[assignments, 'assignments'], [materials, 'materials'], [surveys, 'surveys']].every(([envelope, key]) => {
      const rows = own(envelope, key as string)
      return Array.isArray(rows) && rows.every(row => {
        const id = own(row, 'id')
        return typeof id === 'string' && id.length > 0 && own(row, 'classroom_id') === classroomId
      })
    })
  } catch { return false }
}
