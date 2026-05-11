export type OrderedClassworkItem<TAssignment, TMaterial> =
  | {
      id: string
      type: 'assignment'
      position: number
      createdAt: string
      title: string
      assignment: TAssignment
    }
  | {
      id: string
      type: 'material'
      position: number
      createdAt: string
      title: string
      material: TMaterial
    }

type AssignmentLike = {
  id: string
  title: string
  position?: number | null
  created_at?: string | null
}

type MaterialLike = {
  id: string
  title: string
  position?: number | null
  created_at?: string | null
}

function normalizedPosition(position: number | null | undefined, fallback: number) {
  return typeof position === 'number' && Number.isFinite(position) ? position : fallback
}

export function buildOrderedClassworkItems<
  TAssignment extends AssignmentLike,
  TMaterial extends MaterialLike,
>(
  assignments: TAssignment[],
  materials: TMaterial[],
): OrderedClassworkItem<TAssignment, TMaterial>[] {
  const assignmentItems = assignments.map((assignment, index) => ({
    id: assignment.id,
    type: 'assignment' as const,
    position: normalizedPosition(assignment.position, index),
    createdAt: assignment.created_at || '',
    title: assignment.title,
    assignment,
  }))

  const materialOffset = assignments.length
  const materialItems = materials.map((material, index) => ({
    id: material.id,
    type: 'material' as const,
    position: normalizedPosition(material.position, materialOffset + index),
    createdAt: material.created_at || '',
    title: material.title,
    material,
  }))

  return [...assignmentItems, ...materialItems].sort((left, right) => {
    const positionDelta = left.position - right.position
    if (positionDelta !== 0) return positionDelta

    const createdDelta = left.createdAt.localeCompare(right.createdAt)
    if (createdDelta !== 0) return createdDelta

    const typeDelta = left.type.localeCompare(right.type)
    if (typeDelta !== 0) return typeDelta

    return left.id.localeCompare(right.id)
  })
}
