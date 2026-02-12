import { describe, expect, it } from 'vitest'
import { validateDataset } from '@/lib/teachassist/validator'

describe('teachassist validator', () => {
  it('returns no errors for valid dataset', () => {
    const errors = validateDataset({
      attendance: [{ entity_key: 's1:2026-02-12', student_key: 's1', date: '2026-02-12', status: 'present' }],
      marks: [{ entity_key: 's1:a1', student_key: 's1', assessment_key: 'a1', earned: 8, possible: 10 }],
      report_cards: [{ entity_key: 's1:midterm', student_key: 's1', term: 'midterm', percent: 80 }],
    })

    expect(errors).toEqual([])
  })

  it('flags invalid records', () => {
    const errors = validateDataset({
      attendance: [{ entity_key: '', student_key: '', date: '', status: 'absent' }],
      marks: [{ entity_key: '', student_key: '', assessment_key: '', earned: -1, possible: 0 }],
      report_cards: [{ entity_key: '', student_key: '', term: 'final', percent: 120 }],
    })

    expect(errors.length).toBeGreaterThan(0)
  })
})
