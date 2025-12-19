import { describe, it, expect } from 'vitest'
import { toggleSort, compareNullableStrings, applyDirection } from '@/lib/table-sort'

describe('toggleSort', () => {
  it('should switch to new column with ascending direction', () => {
    const result = toggleSort({ column: 'name', direction: 'desc' }, 'email')
    expect(result).toEqual({ column: 'email', direction: 'asc' })
  })

  it('should toggle from asc to desc on same column', () => {
    const result = toggleSort({ column: 'name', direction: 'asc' }, 'name')
    expect(result).toEqual({ column: 'name', direction: 'desc' })
  })

  it('should toggle from desc to asc on same column', () => {
    const result = toggleSort({ column: 'name', direction: 'desc' }, 'name')
    expect(result).toEqual({ column: 'name', direction: 'asc' })
  })
})

describe('compareNullableStrings', () => {
  it('should compare non-null strings alphabetically', () => {
    expect(compareNullableStrings('apple', 'banana')).toBeLessThan(0)
    expect(compareNullableStrings('banana', 'apple')).toBeGreaterThan(0)
    expect(compareNullableStrings('apple', 'apple')).toBe(0)
  })

  it('should handle null values with missingLast=true (default)', () => {
    expect(compareNullableStrings(null, 'apple')).toBeGreaterThan(0) // null comes last
    expect(compareNullableStrings('apple', null)).toBeLessThan(0) // apple comes first
    expect(compareNullableStrings(null, null)).toBe(0)
  })

  it('should handle empty strings as missing values', () => {
    expect(compareNullableStrings('', 'apple')).toBeGreaterThan(0) // empty comes last
    expect(compareNullableStrings('apple', '')).toBeLessThan(0) // apple comes first
    expect(compareNullableStrings('', '')).toBe(0)
  })

  it('should handle null values with missingLast=false', () => {
    expect(compareNullableStrings(null, 'apple', { missingLast: false })).toBeLessThan(0) // null comes first
    expect(compareNullableStrings('apple', null, { missingLast: false })).toBeGreaterThan(0) // apple comes last
  })

  it('should handle empty strings with missingLast=false', () => {
    expect(compareNullableStrings('', 'apple', { missingLast: false })).toBeLessThan(0) // empty comes first
    expect(compareNullableStrings('apple', '', { missingLast: false })).toBeGreaterThan(0) // apple comes last
  })

  it('should trim whitespace before comparing', () => {
    expect(compareNullableStrings('  apple  ', 'apple')).toBe(0)
    expect(compareNullableStrings('  apple  ', '  banana  ')).toBeLessThan(0)
  })

  it('should treat whitespace-only strings as missing', () => {
    expect(compareNullableStrings('   ', 'apple')).toBeGreaterThan(0) // whitespace comes last
    expect(compareNullableStrings('apple', '   ')).toBeLessThan(0) // apple comes first
  })
})

describe('applyDirection', () => {
  it('should return positive comparison as-is for ascending', () => {
    expect(applyDirection(1, 'asc')).toBe(1)
    expect(applyDirection(5, 'asc')).toBe(5)
  })

  it('should return negative comparison as-is for ascending', () => {
    expect(applyDirection(-1, 'asc')).toBe(-1)
    expect(applyDirection(-5, 'asc')).toBe(-5)
  })

  it('should return zero as-is for ascending', () => {
    expect(applyDirection(0, 'asc')).toBe(0)
  })

  it('should negate comparison for descending', () => {
    expect(applyDirection(1, 'desc')).toBe(-1)
    expect(applyDirection(-1, 'desc')).toBe(1)
    expect(applyDirection(5, 'desc')).toBe(-5)
    expect(applyDirection(-5, 'desc')).toBe(5)
  })

  it('should negate zero for descending (results in -0)', () => {
    // JavaScript has -0 and +0; negating 0 gives -0
    const result = applyDirection(0, 'desc')
    expect(result).toBe(-0)
    expect(Object.is(result, -0)).toBe(true)
  })
})
