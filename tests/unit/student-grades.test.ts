import { describe, expect, it } from 'vitest'
import { buildStudentGradesResponse, type StudentGradeCalculationItem } from '@/lib/student-grades'

function item(overrides: Partial<StudentGradeCalculationItem> = {}): StudentGradeCalculationItem {
  return {
    id: 'item-1',
    kind: 'Classwork',
    title: 'Returned work',
    earned: 8,
    possible: 10,
    percent: 80,
    included: true,
    href: '/feedback',
    categoryId: 'term',
    weight: 10,
    returnedAt: '2026-09-10T12:00:00Z',
    ...overrides,
  }
}

describe('student Grades projection', () => {
  it('calculates the current grade from returned counted work using category and assessment weights', () => {
    const result = buildStudentGradesResponse({
      categories: [{ id: 'term', percentage: 70 }, { id: 'final', percentage: 30 }],
      items: [
        item({ id: 'a', earned: 8, possible: 10, weight: 1, categoryId: 'term' }),
        item({ id: 'b', earned: 10, possible: 10, weight: 3, categoryId: 'term' }),
        item({ id: 'c', kind: 'Test', earned: 15, possible: 20, weight: 1, categoryId: 'final' }),
      ],
    })

    expect(result.currentPercent).toBe(89)
  })

  it('keeps returned excluded work visible without counting it', () => {
    const result = buildStudentGradesResponse({
      categories: [{ id: 'term', percentage: 100 }],
      items: [item(), item({ id: 'practice', title: 'Practice', earned: 10, included: false })],
    })

    expect(result.currentPercent).toBe(80)
    expect(result.items).toHaveLength(2)
    expect(result.items.find((entry) => entry.id === 'practice')?.included).toBe(false)
  })

  it('uses an em-dash state when no returned work contributes and sorts newest first', () => {
    const result = buildStudentGradesResponse({
      categories: [{ id: 'term', percentage: 100 }],
      items: [
        item({ id: 'old', included: false, returnedAt: '2026-09-01T12:00:00Z' }),
        item({ id: 'new', included: false, returnedAt: '2026-09-20T12:00:00Z' }),
      ],
    })

    expect(result.currentPercent).toBeNull()
    expect(result.items.map((entry) => entry.id)).toEqual(['new', 'old'])
    expect(result.items[0]).not.toHaveProperty('returnedAt')
    expect(result.items[0]).not.toHaveProperty('weight')
    expect(result.items[0]).not.toHaveProperty('categoryId')
  })

  it('calculates from raw fractional scores while rounding only the student response', () => {
    const rawEarned = 10 / 30
    const result = buildStudentGradesResponse({
      categories: [{ id: 'term', percentage: 100 }],
      items: [item({ earned: rawEarned, possible: 10, percent: (rawEarned / 10) * 100 })],
    })

    expect(result.currentPercent).toBe(3.33)
    expect(result.items[0]).toMatchObject({ earned: 0.33, possible: 10, percent: 3.33 })
  })
})
