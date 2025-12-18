export type SortDirection = 'asc' | 'desc'

export function toggleSort<TColumn extends string>(
  current: { column: TColumn; direction: SortDirection },
  nextColumn: TColumn
) {
  if (current.column !== nextColumn) {
    return { column: nextColumn, direction: 'asc' as const }
  }
  return { column: current.column, direction: current.direction === 'asc' ? ('desc' as const) : ('asc' as const) }
}

export function compareNullableStrings(a: string | null, b: string | null, opts?: { missingLast?: boolean }) {
  const missingLast = opts?.missingLast ?? true
  const valueA = (a ?? '').trim()
  const valueB = (b ?? '').trim()

  const missingA = valueA ? 0 : 1
  const missingB = valueB ? 0 : 1
  if (missingA !== missingB) {
    return missingLast ? missingA - missingB : missingB - missingA
  }

  return valueA.localeCompare(valueB)
}

export function applyDirection(cmp: number, direction: SortDirection) {
  return direction === 'asc' ? cmp : -cmp
}

