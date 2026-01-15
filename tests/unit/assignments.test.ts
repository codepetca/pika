/**
 * Unit tests for assignment utilities (src/lib/assignments.ts)
 * Tests assignment status calculation and formatting functions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  calculateAssignmentStatus,
  getAssignmentStatusLabel,
  getAssignmentStatusBadgeClass,
  getAssignmentStatusDotClass,
  formatDueDate,
  isPastDue,
  formatRelativeDueDate,
} from '@/lib/assignments'
import { createMockAssignment, createMockAssignmentDoc } from '../helpers/mocks'

describe('assignment utilities', () => {
  // Use fake timers for predictable date testing
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // calculateAssignmentStatus()
  // ==========================================================================

  describe('calculateAssignmentStatus', () => {
    it('should return "not_started" when doc is null', () => {
      vi.setSystemTime(new Date('2024-10-15T12:00:00Z'))
      const assignment = createMockAssignment({
        due_at: '2024-10-20T23:59:59-04:00',
      })

      const status = calculateAssignmentStatus(assignment, null)

      expect(status).toBe('not_started')
    })

    it('should return "not_started" when doc is undefined', () => {
      vi.setSystemTime(new Date('2024-10-15T12:00:00Z'))
      const assignment = createMockAssignment({
        due_at: '2024-10-20T23:59:59-04:00',
      })

      const status = calculateAssignmentStatus(assignment, undefined)

      expect(status).toBe('not_started')
    })

    it('should return "in_progress" when not submitted and before due date', () => {
      vi.setSystemTime(new Date('2024-10-15T12:00:00Z'))
      const assignment = createMockAssignment({
        due_at: '2024-10-20T23:59:59-04:00',
      })
      const doc = createMockAssignmentDoc({
        is_submitted: false,
        submitted_at: null,
      })

      const status = calculateAssignmentStatus(assignment, doc)

      expect(status).toBe('in_progress')
    })

    it('should return "in_progress" when not submitted and exactly at due date', () => {
      vi.setSystemTime(new Date('2024-10-20T23:59:59-04:00'))
      const assignment = createMockAssignment({
        due_at: '2024-10-20T23:59:59-04:00',
      })
      const doc = createMockAssignmentDoc({
        is_submitted: false,
        submitted_at: null,
      })

      const status = calculateAssignmentStatus(assignment, doc)

      expect(status).toBe('in_progress')
    })

    it('should return "in_progress_late" when not submitted and after due date', () => {
      vi.setSystemTime(new Date('2024-10-21T00:00:01-04:00'))
      const assignment = createMockAssignment({
        due_at: '2024-10-20T23:59:59-04:00',
      })
      const doc = createMockAssignmentDoc({
        is_submitted: false,
        submitted_at: null,
      })

      const status = calculateAssignmentStatus(assignment, doc)

      expect(status).toBe('in_progress_late')
    })

    it('should return "submitted_on_time" when submitted before due date', () => {
      vi.setSystemTime(new Date('2024-10-21T12:00:00Z'))
      const assignment = createMockAssignment({
        due_at: '2024-10-20T23:59:59-04:00',
      })
      const doc = createMockAssignmentDoc({
        is_submitted: true,
        submitted_at: '2024-10-18T20:00:00Z',
      })

      const status = calculateAssignmentStatus(assignment, doc)

      expect(status).toBe('submitted_on_time')
    })

    it('should return "submitted_on_time" when submitted exactly at due date', () => {
      vi.setSystemTime(new Date('2024-10-21T12:00:00Z'))
      const assignment = createMockAssignment({
        due_at: '2024-10-20T23:59:59-04:00',
      })
      const doc = createMockAssignmentDoc({
        is_submitted: true,
        submitted_at: '2024-10-20T23:59:59-04:00',
      })

      const status = calculateAssignmentStatus(assignment, doc)

      expect(status).toBe('submitted_on_time')
    })

    it('should return "submitted_late" when submitted after due date', () => {
      vi.setSystemTime(new Date('2024-10-26T12:00:00Z'))
      const assignment = createMockAssignment({
        due_at: '2024-10-20T23:59:59-04:00',
      })
      const doc = createMockAssignmentDoc({
        is_submitted: true,
        submitted_at: '2024-10-26T10:00:00Z',
      })

      const status = calculateAssignmentStatus(assignment, doc)

      expect(status).toBe('submitted_late')
    })

    it('should handle timezone correctly (America/Toronto)', () => {
      vi.setSystemTime(new Date('2024-10-21T04:00:00Z')) // Midnight Toronto time
      const assignment = createMockAssignment({
        due_at: '2024-10-20T23:59:59-04:00',
      })
      const doc = createMockAssignmentDoc({
        is_submitted: false,
        submitted_at: null,
      })

      const status = calculateAssignmentStatus(assignment, doc)

      // Should be late since we're past midnight Toronto time
      expect(status).toBe('in_progress_late')
    })

    it('should handle submission 1 second before deadline', () => {
      vi.setSystemTime(new Date('2024-10-21T12:00:00Z'))
      const assignment = createMockAssignment({
        due_at: '2024-10-20T23:59:59-04:00',
      })
      const doc = createMockAssignmentDoc({
        is_submitted: true,
        submitted_at: '2024-10-20T23:59:58-04:00',
      })

      const status = calculateAssignmentStatus(assignment, doc)

      expect(status).toBe('submitted_on_time')
    })

    it('should handle submission 1 second after deadline', () => {
      vi.setSystemTime(new Date('2024-10-21T12:00:00Z'))
      const assignment = createMockAssignment({
        due_at: '2024-10-20T23:59:59-04:00',
      })
      const doc = createMockAssignmentDoc({
        is_submitted: true,
        submitted_at: '2024-10-21T00:00:00-04:00',
      })

      const status = calculateAssignmentStatus(assignment, doc)

      expect(status).toBe('submitted_late')
    })

    it('should handle doc.is_submitted = true but submitted_at is null (fallback)', () => {
      vi.setSystemTime(new Date('2024-10-15T12:00:00Z'))
      const assignment = createMockAssignment({
        due_at: '2024-10-20T23:59:59-04:00',
      })
      const doc = createMockAssignmentDoc({
        is_submitted: true,
        submitted_at: null,
      })

      const status = calculateAssignmentStatus(assignment, doc)

      // Fallback case - should return submitted_on_time
      expect(status).toBe('submitted_on_time')
    })

    it('should handle future timestamps correctly', () => {
      vi.setSystemTime(new Date('2024-10-15T12:00:00Z'))
      const assignment = createMockAssignment({
        due_at: '2025-10-20T23:59:59-04:00', // Far future
      })
      const doc = createMockAssignmentDoc({
        is_submitted: false,
        submitted_at: null,
      })

      const status = calculateAssignmentStatus(assignment, doc)

      expect(status).toBe('in_progress')
    })
  })

  // ==========================================================================
  // getAssignmentStatusLabel()
  // ==========================================================================

  describe('getAssignmentStatusLabel', () => {
    it('should return "Not started" for not_started', () => {
      expect(getAssignmentStatusLabel('not_started')).toBe('Not started')
    })

    it('should return "In progress" for in_progress', () => {
      expect(getAssignmentStatusLabel('in_progress')).toBe('In progress')
    })

    it('should return "In progress (late)" for in_progress_late', () => {
      expect(getAssignmentStatusLabel('in_progress_late')).toBe('In progress (late)')
    })

    it('should return "Submitted" for submitted_on_time', () => {
      expect(getAssignmentStatusLabel('submitted_on_time')).toBe('Submitted')
    })

    it('should return "Submitted (late)" for submitted_late', () => {
      expect(getAssignmentStatusLabel('submitted_late')).toBe('Submitted (late)')
    })

    it('should return "Unknown" for invalid status', () => {
      expect(getAssignmentStatusLabel('invalid_status' as any)).toBe('Unknown')
    })
  })

  // ==========================================================================
  // getAssignmentStatusBadgeClass()
  // ==========================================================================

  describe('getAssignmentStatusBadgeClass', () => {
    it('should return gray classes for not_started', () => {
      const classes = getAssignmentStatusBadgeClass('not_started')
      expect(classes).toContain('gray')
    })

    it('should return blue classes for in_progress', () => {
      const classes = getAssignmentStatusBadgeClass('in_progress')
      expect(classes).toContain('blue')
    })

    it('should return yellow classes for in_progress_late', () => {
      const classes = getAssignmentStatusBadgeClass('in_progress_late')
      expect(classes).toContain('yellow')
    })

    it('should return green classes for submitted_on_time', () => {
      const classes = getAssignmentStatusBadgeClass('submitted_on_time')
      expect(classes).toContain('green')
    })

    it('should return orange classes for submitted_late', () => {
      const classes = getAssignmentStatusBadgeClass('submitted_late')
      expect(classes).toContain('orange')
    })

    it('should return gray classes for invalid status', () => {
      const classes = getAssignmentStatusBadgeClass('invalid_status' as any)
      expect(classes).toContain('gray')
    })

    it('should return Tailwind utility classes', () => {
      const classes = getAssignmentStatusBadgeClass('in_progress')
      // Should have background and text classes
      expect(classes).toMatch(/bg-\w+/)
      expect(classes).toMatch(/text-\w+/)
    })
  })

  // ==========================================================================
  // getAssignmentStatusDotClass()
  // ==========================================================================

  describe('getAssignmentStatusDotClass', () => {
    it('should return gray for not_started', () => {
      expect(getAssignmentStatusDotClass('not_started')).toBe('bg-gray-400')
    })

    it('should return yellow for in_progress', () => {
      expect(getAssignmentStatusDotClass('in_progress')).toBe('bg-yellow-400')
    })

    it('should return red for in_progress_late', () => {
      expect(getAssignmentStatusDotClass('in_progress_late')).toBe('bg-red-500')
    })

    it('should return green for submitted_on_time', () => {
      expect(getAssignmentStatusDotClass('submitted_on_time')).toBe('bg-green-500')
    })

    it('should return lime for submitted_late', () => {
      expect(getAssignmentStatusDotClass('submitted_late')).toBe('bg-lime-600')
    })

    it('should return gray for invalid status', () => {
      expect(getAssignmentStatusDotClass('invalid_status' as any)).toBe('bg-gray-400')
    })
  })

  // ==========================================================================
  // formatDueDate()
  // ==========================================================================

  describe('formatDueDate', () => {
    it('should format date in America/Toronto timezone', () => {
      const formatted = formatDueDate('2024-10-20T23:59:59-04:00')

      // Should include month and day (no year)
      expect(formatted).toMatch(/Oct|October/)
      expect(formatted).toMatch(/20/)
      expect(formatted).not.toMatch(/\b2024\b/)
    })

    it('should include day of week in formatted output', () => {
      const formatted = formatDueDate('2024-10-20T23:59:00-04:00')

      // Should include day of week (Sun)
      expect(formatted).toMatch(/Sun|Mon|Tue|Wed|Thu|Fri|Sat/)
    })

    it('should format dates without time', () => {
      const formatted = formatDueDate('2024-10-21T00:00:00-04:00')

      // Should NOT include time
      expect(formatted).not.toMatch(/\d{1,2}:\d{2}/)
      // Should include month and day (no year)
      expect(formatted).toMatch(/Oct/)
      expect(formatted).toMatch(/21/)
      expect(formatted).not.toMatch(/\b2024\b/)
    })

    it('should format consistently for different dates', () => {
      const formatted1 = formatDueDate('2024-01-15T10:30:00-05:00')
      const formatted2 = formatDueDate('2024-06-15T14:45:00-04:00')

      // Both should have similar format structure
      expect(typeof formatted1).toBe('string')
      expect(typeof formatted2).toBe('string')
      expect(formatted1.length).toBeGreaterThan(0)
      expect(formatted2.length).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // isPastDue()
  // ==========================================================================

  describe('isPastDue', () => {
    it('should return true when due date is in past', () => {
      vi.setSystemTime(new Date('2024-10-21T12:00:00Z'))

      const result = isPastDue('2024-10-20T23:59:59-04:00')

      expect(result).toBe(true)
    })

    it('should return false when due date is in future', () => {
      vi.setSystemTime(new Date('2024-10-15T12:00:00Z'))

      const result = isPastDue('2024-10-20T23:59:59-04:00')

      expect(result).toBe(false)
    })

    it('should return false when due date is exactly now', () => {
      const now = '2024-10-20T23:59:59Z'
      vi.setSystemTime(new Date(now))

      const result = isPastDue(now)

      expect(result).toBe(false)
    })

    it('should handle timezone correctly', () => {
      vi.setSystemTime(new Date('2024-10-21T04:00:00Z')) // Midnight Toronto

      const result = isPastDue('2024-10-20T23:59:59-04:00')

      expect(result).toBe(true)
    })
  })

  // ==========================================================================
  // formatRelativeDueDate()
  // ==========================================================================

  describe('formatRelativeDueDate', () => {
    describe('future dates', () => {
      it('should return "Due in X days" for multiple days', () => {
        vi.setSystemTime(new Date('2024-10-15T12:00:00Z'))

        const result = formatRelativeDueDate('2024-10-20T12:00:00Z')

        expect(result).toMatch(/Due in \d+ days/)
      })

      it('should return "Due tomorrow" for next day', () => {
        vi.setSystemTime(new Date('2024-10-19T12:00:00Z'))

        const result = formatRelativeDueDate('2024-10-20T12:00:00Z')

        expect(result).toBe('Due tomorrow')
      })

      it('should return "Due in X hours" for same day', () => {
        vi.setSystemTime(new Date('2024-10-20T10:00:00Z'))

        const result = formatRelativeDueDate('2024-10-20T14:00:00Z')

        expect(result).toMatch(/Due in \d+ hours/)
      })

      it('should return "Due in 1 hour" for singular hour', () => {
        vi.setSystemTime(new Date('2024-10-20T12:00:00Z'))

        const result = formatRelativeDueDate('2024-10-20T13:00:00Z')

        expect(result).toBe('Due in 1 hour')
      })

      it('should return "Due in X minutes" for minutes', () => {
        vi.setSystemTime(new Date('2024-10-20T11:50:00Z'))

        const result = formatRelativeDueDate('2024-10-20T12:00:00Z')

        expect(result).toMatch(/Due in \d+ minutes/)
      })

      it('should return "Due now" for immediate', () => {
        vi.setSystemTime(new Date('2024-10-20T12:00:00Z'))

        const result = formatRelativeDueDate('2024-10-20T12:00:30Z')

        expect(result).toBe('Due now')
      })
    })

    describe('past dates', () => {
      it('should return "X days overdue" for past multiple days', () => {
        vi.setSystemTime(new Date('2024-10-25T12:00:00Z'))

        const result = formatRelativeDueDate('2024-10-20T12:00:00Z')

        expect(result).toMatch(/\d+ days overdue/)
      })

      it('should return "1 day overdue" for singular day past', () => {
        vi.setSystemTime(new Date('2024-10-21T12:00:00Z'))

        const result = formatRelativeDueDate('2024-10-20T12:00:00Z')

        expect(result).toBe('1 day overdue')
      })

      it('should return "X hours overdue" for hours past', () => {
        vi.setSystemTime(new Date('2024-10-20T14:00:00Z'))

        const result = formatRelativeDueDate('2024-10-20T10:00:00Z')

        expect(result).toMatch(/\d+ hours overdue/)
      })

      it('should return "1 hour overdue" for singular hour past', () => {
        vi.setSystemTime(new Date('2024-10-20T13:00:00Z'))

        const result = formatRelativeDueDate('2024-10-20T12:00:00Z')

        expect(result).toBe('1 hour overdue')
      })

      it('should return "X minutes overdue" for minutes past', () => {
        vi.setSystemTime(new Date('2024-10-20T12:10:00Z'))

        const result = formatRelativeDueDate('2024-10-20T12:00:00Z')

        expect(result).toMatch(/\d+ minutes overdue/)
      })

      it('should return "Just passed" for immediate past', () => {
        vi.setSystemTime(new Date('2024-10-20T12:00:30Z'))

        const result = formatRelativeDueDate('2024-10-20T12:00:00Z')

        expect(result).toBe('Just passed')
      })
    })
  })
})
