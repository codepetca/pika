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

/**
 * Compare two rows by name fields with proper tiebreaking:
 * - Sort by last_name → tiebreak by first_name → tiebreak by id
 * - Sort by first_name → tiebreak by last_name → tiebreak by id
 */
export function compareByNameFields(
  a: { firstName: string | null; lastName: string | null; id: string },
  b: { firstName: string | null; lastName: string | null; id: string },
  sortColumn: 'first_name' | 'last_name',
  direction: SortDirection
): number {
  const primary = sortColumn === 'first_name' ? 'firstName' : 'lastName'
  const secondary = sortColumn === 'first_name' ? 'lastName' : 'firstName'

  const cmp1 = compareNullableStrings(a[primary], b[primary], { missingLast: true })
  if (cmp1 !== 0) return applyDirection(cmp1, direction)

  const cmp2 = compareNullableStrings(a[secondary], b[secondary], { missingLast: true })
  if (cmp2 !== 0) return applyDirection(cmp2, direction)

  return applyDirection(a.id.localeCompare(b.id), direction)
}

