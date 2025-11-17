import { describe, it, expect } from 'vitest'
import { computeAttendanceStatusForStudent, getAttendanceIcon, getAttendanceLabel } from '@/lib/attendance'
import type { ClassDay, Entry } from '@/types'

describe('attendance utilities', () => {
  const classDays: ClassDay[] = [
    { id: '1', course_code: 'GLD2O', date: '2024-09-01', is_class_day: true, prompt_text: null },
    { id: '2', course_code: 'GLD2O', date: '2024-09-02', is_class_day: true, prompt_text: null },
    { id: '3', course_code: 'GLD2O', date: '2024-09-03', is_class_day: true, prompt_text: null },
    { id: '4', course_code: 'GLD2O', date: '2024-09-04', is_class_day: false, prompt_text: null }, // Not a class day
  ]

  describe('computeAttendanceStatusForStudent', () => {
    it('should return absent when no entry exists', () => {
      const entries: Entry[] = []

      const result = computeAttendanceStatusForStudent(classDays, entries)

      expect(result['2024-09-01']).toBe('absent')
      expect(result['2024-09-02']).toBe('absent')
      expect(result['2024-09-03']).toBe('absent')
      expect(result['2024-09-04']).toBeUndefined() // Not a class day
    })

    it('should return present when entry was submitted on time', () => {
      const entries: Entry[] = [
        {
          id: '1',
          student_id: 'student1',
          course_code: 'GLD2O',
          date: '2024-09-01',
          text: 'My entry',
          minutes_reported: 60,
          mood: '😊',
          created_at: '2024-09-01T20:00:00Z',
          updated_at: '2024-09-01T20:00:00Z',
          on_time: true,
        },
      ]

      const result = computeAttendanceStatusForStudent(classDays, entries)

      expect(result['2024-09-01']).toBe('present')
    })

    it('should return present when entry exists regardless of on_time status', () => {
      const entries: Entry[] = [
        {
          id: '1',
          student_id: 'student1',
          course_code: 'GLD2O',
          date: '2024-09-01',
          text: 'My entry',
          minutes_reported: 60,
          mood: '😊',
          created_at: '2024-09-01T23:30:00Z',
          updated_at: '2024-09-02T02:00:00Z',
          on_time: false,
        },
      ]

      const result = computeAttendanceStatusForStudent(classDays, entries)

      expect(result['2024-09-01']).toBe('present')
    })

    it('should handle mixed attendance statuses', () => {
      const entries: Entry[] = [
        {
          id: '1',
          student_id: 'student1',
          course_code: 'GLD2O',
          date: '2024-09-01',
          text: 'Entry 1',
          minutes_reported: 60,
          mood: '😊',
          created_at: '2024-09-01T20:00:00Z',
          updated_at: '2024-09-01T20:00:00Z',
          on_time: true,
        },
        {
          id: '2',
          student_id: 'student1',
          course_code: 'GLD2O',
          date: '2024-09-02',
          text: 'Entry 2',
          minutes_reported: 60,
          mood: '😊',
          created_at: '2024-09-03T01:00:00Z',
          updated_at: '2024-09-03T01:00:00Z',
          on_time: false,
        },
      ]

      const result = computeAttendanceStatusForStudent(classDays, entries)

      expect(result['2024-09-01']).toBe('present')
      expect(result['2024-09-02']).toBe('present')
      expect(result['2024-09-03']).toBe('absent')
    })

    it('should only consider days where is_class_day is true', () => {
      const entries: Entry[] = []

      const result = computeAttendanceStatusForStudent(classDays, entries)

      // Non-class day should not appear in results
      expect(result['2024-09-04']).toBeUndefined()
      expect(Object.keys(result)).not.toContain('2024-09-04')
    })
  })

  describe('getAttendanceIcon', () => {
    it('should return correct icons', () => {
      expect(getAttendanceIcon('present')).toBe('🟢')
      expect(getAttendanceIcon('absent')).toBe('🔴')
    })
  })

  describe('getAttendanceLabel', () => {
    it('should return correct labels', () => {
      expect(getAttendanceLabel('present')).toBe('Present')
      expect(getAttendanceLabel('absent')).toBe('Absent')
    })
  })
})
