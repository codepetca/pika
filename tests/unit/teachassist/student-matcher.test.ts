import { describe, expect, it } from 'vitest'
import {
  normalizeName,
  levenshteinSimilarity,
  matchStudents,
} from '@/lib/teachassist/student-matcher'
import type { TAStudentRow } from '@/lib/teachassist/types'

describe('normalizeName', () => {
  it('lowercases and trims', () => {
    expect(normalizeName('  John  ')).toBe('john')
  })

  it('strips diacritics / accents', () => {
    expect(normalizeName('José')).toBe('jose')
    expect(normalizeName('Müller')).toBe('muller')
    expect(normalizeName('François')).toBe('francois')
  })

  it('handles empty string', () => {
    expect(normalizeName('')).toBe('')
  })

  it('collapses internal whitespace', () => {
    expect(normalizeName('Mary  Jane')).toBe('mary jane')
  })
})

describe('levenshteinSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(levenshteinSimilarity('smith', 'smith')).toBe(1)
  })

  it('returns 0 for completely different strings', () => {
    expect(levenshteinSimilarity('abc', 'xyz')).toBe(0)
  })

  it('returns fraction for partial match', () => {
    const sim = levenshteinSimilarity('smith', 'smyth')
    expect(sim).toBeGreaterThan(0.5)
    expect(sim).toBeLessThan(1)
  })

  it('handles empty strings', () => {
    expect(levenshteinSimilarity('', '')).toBe(1)
    expect(levenshteinSimilarity('abc', '')).toBe(0)
    expect(levenshteinSimilarity('', 'abc')).toBe(0)
  })
})

describe('matchStudents', () => {
  const taStudents: TAStudentRow[] = [
    { name: 'Smith, John', radioName: 'r100_attendance_200' },
    { name: 'Doe, Jane', radioName: 'r101_attendance_200' },
    { name: 'Lee, Emmett', radioName: 'r102_attendance_200' },
    { name: "Dell'Anno, Gabriella", radioName: 'r103_attendance_200' },
    { name: 'Campagna-Terrell, Jaya', radioName: 'r104_attendance_200' },
  ]

  it('matches exact names (case-insensitive)', () => {
    const pika = [{ student_id: 's1', first_name: 'John', last_name: 'Smith' }]
    const results = matchStudents(pika, taStudents)

    expect(results).toHaveLength(1)
    expect(results[0].matched).toBe(true)
    expect(results[0].confidence).toBe(100)
    expect(results[0].ta_name).toBe('Smith, John')
    expect(results[0].ta_radio_name).toBe('r100_attendance_200')
  })

  it('matches with different casing', () => {
    const pika = [{ student_id: 's1', first_name: 'JANE', last_name: 'doe' }]
    const results = matchStudents(pika, taStudents)

    expect(results[0].matched).toBe(true)
    expect(results[0].confidence).toBe(100)
  })

  it('handles apostrophes in names', () => {
    const pika = [{ student_id: 's1', first_name: 'Gabriella', last_name: "Dell'Anno" }]
    const results = matchStudents(pika, taStudents)

    expect(results[0].matched).toBe(true)
    expect(results[0].ta_name).toBe("Dell'Anno, Gabriella")
  })

  it('handles hyphenated names', () => {
    const pika = [{ student_id: 's1', first_name: 'Jaya', last_name: 'Campagna-Terrell' }]
    const results = matchStudents(pika, taStudents)

    expect(results[0].matched).toBe(true)
  })

  it('fuzzy matches with minor typo', () => {
    const pika = [{ student_id: 's1', first_name: 'Jon', last_name: 'Smith' }]
    const results = matchStudents(pika, taStudents)

    expect(results[0].matched).toBe(true)
    expect(results[0].confidence).toBeGreaterThanOrEqual(80)
    expect(results[0].confidence).toBeLessThan(100)
    expect(results[0].ta_name).toBe('Smith, John')
  })

  it('returns unmatched when no good match exists', () => {
    const pika = [{ student_id: 's1', first_name: 'Alice', last_name: 'Unknown' }]
    const results = matchStudents(pika, taStudents)

    expect(results[0].matched).toBe(false)
    expect(results[0].ta_name).toBeNull()
    expect(results[0].ta_radio_name).toBeNull()
    expect(results[0].confidence).toBeLessThan(80)
  })

  it('matches multiple students correctly', () => {
    const pika = [
      { student_id: 's1', first_name: 'John', last_name: 'Smith' },
      { student_id: 's2', first_name: 'Jane', last_name: 'Doe' },
      { student_id: 's3', first_name: 'Emmett', last_name: 'Lee' },
    ]
    const results = matchStudents(pika, taStudents)

    expect(results).toHaveLength(3)
    expect(results.every(r => r.matched)).toBe(true)
  })

  it('handles empty Pika list', () => {
    const results = matchStudents([], taStudents)
    expect(results).toHaveLength(0)
  })

  it('handles empty TA list', () => {
    const pika = [{ student_id: 's1', first_name: 'John', last_name: 'Smith' }]
    const results = matchStudents(pika, [])

    expect(results).toHaveLength(1)
    expect(results[0].matched).toBe(false)
  })

  it('handles accented names in Pika matching plain TA names', () => {
    const taWithPlain: TAStudentRow[] = [
      { name: 'Muller, Francois', radioName: 'r200_attendance_300' },
    ]
    const pika = [{ student_id: 's1', first_name: 'François', last_name: 'Müller' }]
    const results = matchStudents(pika, taWithPlain)

    expect(results[0].matched).toBe(true)
    expect(results[0].confidence).toBe(100)
  })

  it('does not double-match a TA student to multiple Pika students', () => {
    const pika = [
      { student_id: 's1', first_name: 'John', last_name: 'Smith' },
      { student_id: 's2', first_name: 'Jon', last_name: 'Smith' },
    ]
    const results = matchStudents(pika, taStudents)

    // First exact match gets it, second fuzzy match should not re-use
    const matchedRadios = results.filter(r => r.matched).map(r => r.ta_radio_name)
    const uniqueRadios = new Set(matchedRadios)
    expect(matchedRadios.length).toBe(uniqueRadios.size) // no duplicates
  })
})
