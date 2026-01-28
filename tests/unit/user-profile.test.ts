import { describe, it, expect, vi } from 'vitest'
import { parseTeacherEmail, getUserDisplayInfo } from '@/lib/user-profile'

describe('parseTeacherEmail', () => {
  it('parses standard dot-separated email (first.last)', () => {
    const result = parseTeacherEmail('john.smith@yrdsb.ca')
    expect(result).toEqual({ first_name: 'John', last_name: 'Smith' })
  })

  it('parses email with multiple dots (first.middle.last)', () => {
    const result = parseTeacherEmail('john.piper.smith@yrdsb.ca')
    expect(result).toEqual({ first_name: 'John', last_name: 'Smith' })
  })

  it('parses single-part email (admin)', () => {
    const result = parseTeacherEmail('admin@yrdsb.ca')
    expect(result).toEqual({ first_name: 'Admin', last_name: null })
  })

  it('handles empty local part', () => {
    const result = parseTeacherEmail('@yrdsb.ca')
    expect(result).toEqual({ first_name: null, last_name: null })
  })

  it('capitalizes names correctly', () => {
    const result = parseTeacherEmail('JOHN.SMITH@yrdsb.ca')
    expect(result).toEqual({ first_name: 'John', last_name: 'Smith' })
  })

  it('handles hyphenated names as single part (no dot)', () => {
    // john-smith has no dots, so it's treated as a single-part name
    const result = parseTeacherEmail('john-smith@yrdsb.ca')
    expect(result).toEqual({ first_name: 'John-smith', last_name: null })
  })
})

describe('getUserDisplayInfo', () => {
  it('returns parsed email for teachers (no DB query)', async () => {
    const mockSupabase = {
      from: vi.fn(),
    }

    const result = await getUserDisplayInfo(
      { id: 'teacher-1', email: 'jane.doe@yrdsb.ca', role: 'teacher' },
      mockSupabase as any
    )

    expect(result).toEqual({ first_name: 'Jane', last_name: 'Doe' })
    // Should NOT query DB for teachers
    expect(mockSupabase.from).not.toHaveBeenCalled()
  })

  it('queries student_profiles for students and returns name', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { first_name: 'Alice', last_name: 'Smith' },
              error: null,
            }),
          }),
        }),
      }),
    }

    const result = await getUserDisplayInfo(
      { id: 'student-1', email: '123456789@yrdsb.ca', role: 'student' },
      mockSupabase as any
    )

    expect(result).toEqual({ first_name: 'Alice', last_name: 'Smith' })
    expect(mockSupabase.from).toHaveBeenCalledWith('student_profiles')
  })

  it('returns nulls for students without profile', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { code: 'PGRST116' },
            }),
          }),
        }),
      }),
    }

    const result = await getUserDisplayInfo(
      { id: 'student-2', email: '987654321@yrdsb.ca', role: 'student' },
      mockSupabase as any
    )

    expect(result).toEqual({ first_name: null, last_name: null })
  })

  it('gracefully handles DB errors for students', async () => {
    const mockSupabase = {
      from: vi.fn().mockImplementation(() => {
        throw new Error('Connection failed')
      }),
    }

    const result = await getUserDisplayInfo(
      { id: 'student-3', email: '111222333@yrdsb.ca', role: 'student' },
      mockSupabase as any
    )

    // Should not throw, should return nulls
    expect(result).toEqual({ first_name: null, last_name: null })
  })
})
