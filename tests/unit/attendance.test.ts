import { describe, it, expect } from 'vitest'
import {
  computeAttendanceStatusForStudent,
  computeAttendanceRecords,
  getAttendanceIcon,
  getAttendanceLabel,
  getAttendanceDotClass,
} from '@/lib/attendance'
import type { ClassDay, Entry } from '@/types'

describe('attendance utilities', () => {
  const classDays: ClassDay[] = [
    { id: '1', course_code: 'GLD2O', date: '2024-09-01', is_class_day: true, prompt_text: null },
    { id: '2', course_code: 'GLD2O', date: '2024-09-02', is_class_day: true, prompt_text: null },
    { id: '3', course_code: 'GLD2O', date: '2024-09-03', is_class_day: true, prompt_text: null },
    { id: '4', course_code: 'GLD2O', date: '2024-09-04', is_class_day: false, prompt_text: null }, // Not a class day
  ]

  // Use a fixed "today" that is after all the test class days
  const pastToday = '2024-09-10'

  describe('computeAttendanceStatusForStudent', () => {
    it('should return absent when no entry exists for past days', () => {
      const entries: Entry[] = []

      const result = computeAttendanceStatusForStudent(classDays, entries, pastToday)

      expect(result['2024-09-01']).toBe('absent')
      expect(result['2024-09-02']).toBe('absent')
      expect(result['2024-09-03']).toBe('absent')
      expect(result['2024-09-04']).toBeUndefined() // Not a class day
    })

    it('should return pending when no entry exists for today or future days', () => {
      const entries: Entry[] = []
      const today = '2024-09-02' // 09-02 is "today", 09-03 is future

      const result = computeAttendanceStatusForStudent(classDays, entries, today)

      expect(result['2024-09-01']).toBe('absent')  // Past
      expect(result['2024-09-02']).toBe('pending') // Today
      expect(result['2024-09-03']).toBe('pending') // Future
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

      const result = computeAttendanceStatusForStudent(classDays, entries, pastToday)

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

      const result = computeAttendanceStatusForStudent(classDays, entries, pastToday)

      expect(result['2024-09-01']).toBe('present')
    })

    it('should return present immediately when entry exists today', () => {
      const today = '2024-09-02'
      const entries: Entry[] = [
        {
          id: '1',
          student_id: 'student1',
          course_code: 'GLD2O',
          date: '2024-09-02',
          text: 'My entry for today',
          minutes_reported: 60,
          mood: '😊',
          created_at: '2024-09-02T15:00:00Z',
          updated_at: '2024-09-02T15:00:00Z',
          on_time: true,
        },
      ]

      const result = computeAttendanceStatusForStudent(classDays, entries, today)

      expect(result['2024-09-02']).toBe('present') // Today with entry = present immediately
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

      const result = computeAttendanceStatusForStudent(classDays, entries, pastToday)

      expect(result['2024-09-01']).toBe('present')
      expect(result['2024-09-02']).toBe('present')
      expect(result['2024-09-03']).toBe('absent')
    })

    it('should only consider days where is_class_day is true', () => {
      const entries: Entry[] = []

      const result = computeAttendanceStatusForStudent(classDays, entries, pastToday)

      // Non-class day should not appear in results
      expect(result['2024-09-04']).toBeUndefined()
      expect(Object.keys(result)).not.toContain('2024-09-04')
    })

    it('should return absent when entry exists but text is empty', () => {
      const entries: Entry[] = [
        {
          id: '1',
          student_id: 'student1',
          course_code: 'GLD2O',
          date: '2024-09-01',
          text: '',
          minutes_reported: 0,
          mood: null,
          created_at: '2024-09-01T20:00:00Z',
          updated_at: '2024-09-01T20:00:00Z',
          on_time: true,
        },
      ]

      const result = computeAttendanceStatusForStudent(classDays, entries, pastToday)

      expect(result['2024-09-01']).toBe('absent')
    })

    it('should return absent when entry exists but text is only whitespace', () => {
      const entries: Entry[] = [
        {
          id: '1',
          student_id: 'student1',
          course_code: 'GLD2O',
          date: '2024-09-01',
          text: '   \n\t  ',
          minutes_reported: 0,
          mood: null,
          created_at: '2024-09-01T20:00:00Z',
          updated_at: '2024-09-01T20:00:00Z',
          on_time: true,
        },
      ]

      const result = computeAttendanceStatusForStudent(classDays, entries, pastToday)

      expect(result['2024-09-01']).toBe('absent')
    })

    it('should return pending for today when entry exists but is empty', () => {
      const today = '2024-09-02'
      const entries: Entry[] = [
        {
          id: '1',
          student_id: 'student1',
          course_code: 'GLD2O',
          date: '2024-09-02',
          text: '',
          minutes_reported: 0,
          mood: null,
          created_at: '2024-09-02T15:00:00Z',
          updated_at: '2024-09-02T15:00:00Z',
          on_time: true,
        },
      ]

      const result = computeAttendanceStatusForStudent(classDays, entries, today)

      expect(result['2024-09-02']).toBe('pending')
    })
  })

  describe('computeAttendanceRecords', () => {
    it('should compute per-student attendance and summaries for past days', () => {
      const students = [
        { id: 'student1', email: 'student1@example.com', first_name: 'Alice', last_name: 'Smith' },
        { id: 'student2', email: 'student2@example.com', first_name: 'Bob', last_name: 'Jones' },
      ]

      const allEntries: Entry[] = [
        {
          id: 'e1',
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
          id: 'e2',
          student_id: 'student2',
          course_code: 'GLD2O',
          date: '2024-09-02',
          text: 'Entry 2',
          minutes_reported: 30,
          mood: '😊',
          created_at: '2024-09-02T20:00:00Z',
          updated_at: '2024-09-02T20:00:00Z',
          on_time: true,
        },
      ]

      const records = computeAttendanceRecords(students, classDays, allEntries, pastToday)
      expect(records).toHaveLength(2)

      const record1 = records.find(r => r.student_id === 'student1')!
      expect(record1.student_email).toBe('student1@example.com')
      expect(record1.dates).toEqual({
        '2024-09-01': 'present',
        '2024-09-02': 'absent',
        '2024-09-03': 'absent',
      })
      expect(record1.summary).toEqual({ present: 1, absent: 2 })

      const record2 = records.find(r => r.student_id === 'student2')!
      expect(record2.student_email).toBe('student2@example.com')
      expect(record2.dates).toEqual({
        '2024-09-01': 'absent',
        '2024-09-02': 'present',
        '2024-09-03': 'absent',
      })
      expect(record2.summary).toEqual({ present: 1, absent: 2 })
    })

    it('should not count pending days in summary', () => {
      const students = [
        { id: 'student1', email: 'student1@example.com', first_name: 'Alice', last_name: 'Smith' },
      ]

      const allEntries: Entry[] = [
        {
          id: 'e1',
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
      ]

      // Set today to 09-02, so 09-02 and 09-03 are pending
      const today = '2024-09-02'
      const records = computeAttendanceRecords(students, classDays, allEntries, today)

      const record = records[0]
      expect(record.dates).toEqual({
        '2024-09-01': 'present',
        '2024-09-02': 'pending',
        '2024-09-03': 'pending',
      })
      // Summary only counts present and absent, not pending
      expect(record.summary).toEqual({ present: 1, absent: 0 })
    })
  })

  describe('getAttendanceIcon', () => {
    it('should return correct icons', () => {
      expect(getAttendanceIcon('present')).toBe('🟢')
      expect(getAttendanceIcon('absent')).toBe('🔴')
      expect(getAttendanceIcon('pending')).toBe('⚪')
    })
  })

  describe('getAttendanceLabel', () => {
    it('should return correct labels', () => {
      expect(getAttendanceLabel('present')).toBe('Present')
      expect(getAttendanceLabel('absent')).toBe('Absent')
      expect(getAttendanceLabel('pending')).toBe('Pending')
    })
  })

  describe('getAttendanceDotClass', () => {
    it('should return green for present', () => {
      expect(getAttendanceDotClass('present')).toBe('bg-green-500')
    })

    it('should return red for absent', () => {
      expect(getAttendanceDotClass('absent')).toBe('bg-red-500')
    })

    it('should return gray for pending', () => {
      expect(getAttendanceDotClass('pending')).toBe('bg-gray-400')
    })
  })
})
