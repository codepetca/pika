import { describe, it, expect } from 'vitest'
import { parseRosterInput } from '@/lib/roster-parser'

describe('parseRosterInput', () => {
  describe('single line parsing', () => {
    it('parses space-separated format: First Last Email', () => {
      const input = 'John Doe john@example.com'
      const result = parseRosterInput(input)

      expect(result.students).toHaveLength(1)
      expect(result.students[0]).toEqual({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
      })
      expect(result.errors).toHaveLength(0)
    })

    it('parses comma-separated format: First, Last, Email', () => {
      const input = 'John, Doe, john@example.com'
      const result = parseRosterInput(input)

      expect(result.students).toHaveLength(1)
      expect(result.students[0]).toEqual({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
      })
      expect(result.errors).toHaveLength(0)
    })

    it('parses tab-separated format: First\tLast\tEmail', () => {
      const input = 'John\tDoe\tjohn@example.com'
      const result = parseRosterInput(input)

      expect(result.students).toHaveLength(1)
      expect(result.students[0]).toEqual({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
      })
      expect(result.errors).toHaveLength(0)
    })

    it('parses with optional student number (4th field)', () => {
      const input = 'John Doe john@example.com 123456'
      const result = parseRosterInput(input)

      expect(result.students).toHaveLength(1)
      expect(result.students[0]).toEqual({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        studentNumber: '123456',
      })
      expect(result.errors).toHaveLength(0)
    })

    it('parses comma-separated with student number', () => {
      const input = 'John, Doe, john@example.com, 123456'
      const result = parseRosterInput(input)

      expect(result.students).toHaveLength(1)
      expect(result.students[0]).toEqual({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        studentNumber: '123456',
      })
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('multiple lines', () => {
    it('parses multiple students (space-separated)', () => {
      const input = `John Doe john@example.com
Jane Smith jane@example.com
Bob Wilson bob@example.com 789012`

      const result = parseRosterInput(input)

      expect(result.students).toHaveLength(3)
      expect(result.students[0]).toEqual({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
      })
      expect(result.students[1]).toEqual({
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane@example.com',
      })
      expect(result.students[2]).toEqual({
        firstName: 'Bob',
        lastName: 'Wilson',
        email: 'bob@example.com',
        studentNumber: '789012',
      })
      expect(result.errors).toHaveLength(0)
    })

    it('parses mixed formats (tabs, commas, spaces)', () => {
      const input = `John Doe john@example.com
Jane, Smith, jane@example.com
Bob\tWilson\tbob@example.com`

      const result = parseRosterInput(input)

      expect(result.students).toHaveLength(3)
      expect(result.students[0].email).toBe('john@example.com')
      expect(result.students[1].email).toBe('jane@example.com')
      expect(result.students[2].email).toBe('bob@example.com')
      expect(result.errors).toHaveLength(0)
    })

    it('handles empty lines gracefully', () => {
      const input = `John Doe john@example.com

Jane Smith jane@example.com

`

      const result = parseRosterInput(input)

      expect(result.students).toHaveLength(2)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('validation and errors', () => {
    it('returns error for line with missing email', () => {
      const input = 'John Doe'
      const result = parseRosterInput(input)

      expect(result.students).toHaveLength(0)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toMatchObject({
        line: 1,
        error: expect.stringContaining('email'),
        raw: 'John Doe',
      })
    })

    it('returns error for invalid email format', () => {
      const input = 'John Doe notanemail'
      const result = parseRosterInput(input)

      expect(result.students).toHaveLength(0)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toMatchObject({
        line: 1,
        error: expect.stringContaining('Invalid email'),
      })
    })

    it('returns error for line with only one name', () => {
      const input = 'John john@example.com'
      const result = parseRosterInput(input)

      expect(result.students).toHaveLength(0)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toMatchObject({
        line: 1,
        error: expect.stringContaining('first and last name'),
      })
    })

    it('processes valid lines and reports errors for invalid lines', () => {
      const input = `John Doe john@example.com
Invalid Line
Jane Smith jane@example.com
Bob notanemail`

      const result = parseRosterInput(input)

      expect(result.students).toHaveLength(2)
      expect(result.students[0].email).toBe('john@example.com')
      expect(result.students[1].email).toBe('jane@example.com')
      expect(result.errors).toHaveLength(2)
      expect(result.errors[0].line).toBe(2)
      expect(result.errors[1].line).toBe(4)
    })
  })

  describe('edge cases', () => {
    it('handles names with multiple spaces between tokens', () => {
      const input = 'John    Doe    john@example.com'
      const result = parseRosterInput(input)

      expect(result.students).toHaveLength(1)
      expect(result.students[0]).toEqual({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
      })
    })

    it('trims whitespace from all fields', () => {
      const input = '  John  ,  Doe  ,  john@example.com  '
      const result = parseRosterInput(input)

      expect(result.students).toHaveLength(1)
      expect(result.students[0]).toEqual({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
      })
    })

    it('handles empty input', () => {
      const result = parseRosterInput('')

      expect(result.students).toHaveLength(0)
      expect(result.errors).toHaveLength(0)
    })

    it('handles whitespace-only input', () => {
      const result = parseRosterInput('   \n\n   ')

      expect(result.students).toHaveLength(0)
      expect(result.errors).toHaveLength(0)
    })

    it('normalizes email to lowercase', () => {
      const input = 'John Doe JOHN@EXAMPLE.COM'
      const result = parseRosterInput(input)

      expect(result.students).toHaveLength(1)
      expect(result.students[0].email).toBe('john@example.com')
    })

    it('handles hyphenated last names', () => {
      const input = 'John Smith-Jones john@example.com'
      const result = parseRosterInput(input)

      expect(result.students).toHaveLength(1)
      expect(result.students[0]).toEqual({
        firstName: 'John',
        lastName: 'Smith-Jones',
        email: 'john@example.com',
      })
    })

    it('handles names with apostrophes', () => {
      const input = "John O'Brien john@example.com"
      const result = parseRosterInput(input)

      expect(result.students).toHaveLength(1)
      expect(result.students[0]).toEqual({
        firstName: 'John',
        lastName: "O'Brien",
        email: 'john@example.com',
      })
    })
  })
})
