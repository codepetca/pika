import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertStudentCanAccessClassroom,
  assertTeacherCanMutateClassroom,
  assertTeacherOwnsClassroom,
} from '@/lib/server/classrooms'
import {
  assertStudentCanAccessQuiz,
  assertTeacherOwnsQuiz,
} from '@/lib/server/quizzes'
import {
  assertStudentCanAccessTest,
  assertTeacherOwnsTest,
  isMissingTestAttemptReturnColumnsError,
  isMissingTestResponseAiColumnsError,
} from '@/lib/server/tests'

const mockSupabaseClient = {
  from: vi.fn(),
}

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

function createSingleSelectResult(result: { data: unknown; error: unknown }) {
  const chain: any = {
    eq: vi.fn(() => chain),
    single: vi.fn().mockResolvedValue(result),
  }

  return {
    select: vi.fn(() => chain),
  }
}

describe('server access helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('classroom access', () => {
    it('returns 404 when the classroom does not exist', async () => {
      mockSupabaseClient.from.mockImplementation((table: string) => {
        expect(table).toBe('classrooms')
        return createSingleSelectResult({ data: null, error: { code: 'PGRST116' } })
      })

      await expect(assertTeacherOwnsClassroom('teacher-1', 'classroom-1')).resolves.toEqual({
        ok: false,
        status: 404,
        error: 'Classroom not found',
      })
    })

    it('returns 403 when a different teacher owns the classroom', async () => {
      mockSupabaseClient.from.mockImplementation((table: string) => {
        expect(table).toBe('classrooms')
        return createSingleSelectResult({
          data: { id: 'classroom-1', teacher_id: 'teacher-2', archived_at: null },
          error: null,
        })
      })

      await expect(assertTeacherOwnsClassroom('teacher-1', 'classroom-1')).resolves.toEqual({
        ok: false,
        status: 403,
        error: 'Forbidden',
      })
    })

    it('blocks mutation when the classroom is archived', async () => {
      mockSupabaseClient.from.mockImplementation((table: string) => {
        expect(table).toBe('classrooms')
        return createSingleSelectResult({
          data: { id: 'classroom-1', teacher_id: 'teacher-1', archived_at: '2026-03-01T00:00:00.000Z' },
          error: null,
        })
      })

      await expect(assertTeacherCanMutateClassroom('teacher-1', 'classroom-1')).resolves.toEqual({
        ok: false,
        status: 403,
        error: 'Classroom is archived',
      })
    })

    it('returns 403 when the student is not enrolled', async () => {
      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'classrooms') {
          return createSingleSelectResult({
            data: { id: 'classroom-1', archived_at: null },
            error: null,
          })
        }

        expect(table).toBe('classroom_enrollments')
        return createSingleSelectResult({ data: null, error: { code: 'PGRST116' } })
      })

      await expect(assertStudentCanAccessClassroom('student-1', 'classroom-1')).resolves.toEqual({
        ok: false,
        status: 403,
        error: 'Not enrolled in this classroom',
      })
    })

    it('returns the classroom when the student is enrolled in an active classroom', async () => {
      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'classrooms') {
          return createSingleSelectResult({
            data: { id: 'classroom-1', archived_at: null },
            error: null,
          })
        }

        expect(table).toBe('classroom_enrollments')
        return createSingleSelectResult({
          data: { id: 'enrollment-1' },
          error: null,
        })
      })

      await expect(assertStudentCanAccessClassroom('student-1', 'classroom-1')).resolves.toEqual({
        ok: true,
        classroom: { id: 'classroom-1', archived_at: null },
      })
    })
  })

  describe('quiz access', () => {
    it('returns 403 when the teacher requests archived quiz access with archived checks enabled', async () => {
      mockSupabaseClient.from.mockImplementation((table: string) => {
        expect(table).toBe('quizzes')
        return createSingleSelectResult({
          data: {
            id: 'quiz-1',
            classroom_id: 'classroom-1',
            status: 'active',
            opens_at: null,
            title: 'Quiz 1',
            show_results: false,
            position: 0,
            created_by: 'teacher-1',
            created_at: '2026-03-01T00:00:00.000Z',
            updated_at: '2026-03-01T00:00:00.000Z',
            classrooms: {
              id: 'classroom-1',
              teacher_id: 'teacher-1',
              archived_at: '2026-03-02T00:00:00.000Z',
            },
          },
          error: null,
        })
      })

      await expect(assertTeacherOwnsQuiz('teacher-1', 'quiz-1', { checkArchived: true })).resolves.toEqual({
        ok: false,
        status: 403,
        error: 'Classroom is archived',
      })
    })

    it('returns 404 when the quiz does not exist for a student', async () => {
      mockSupabaseClient.from.mockImplementation((table: string) => {
        expect(table).toBe('quizzes')
        return createSingleSelectResult({ data: null, error: { code: 'PGRST116' } })
      })

      await expect(assertStudentCanAccessQuiz('student-1', 'quiz-1')).resolves.toEqual({
        ok: false,
        status: 404,
        error: 'Quiz not found',
      })
    })

    it('returns the quiz when the student is enrolled in an active classroom', async () => {
      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'quizzes') {
          return createSingleSelectResult({
            data: {
              id: 'quiz-1',
              classroom_id: 'classroom-1',
              status: 'active',
              opens_at: null,
              title: 'Quiz 1',
              show_results: false,
              position: 0,
              created_by: 'teacher-1',
              created_at: '2026-03-01T00:00:00.000Z',
              updated_at: '2026-03-01T00:00:00.000Z',
              classrooms: {
                id: 'classroom-1',
                teacher_id: 'teacher-1',
                archived_at: null,
              },
            },
            error: null,
          })
        }

        expect(table).toBe('classroom_enrollments')
        return createSingleSelectResult({ data: { id: 'enrollment-1' }, error: null })
      })

      const result = await assertStudentCanAccessQuiz('student-1', 'quiz-1')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.quiz.id).toBe('quiz-1')
        expect(result.quiz.classrooms.archived_at).toBeNull()
      }
    })
  })

  describe('test access', () => {
    it('returns 403 when a different teacher owns the test', async () => {
      mockSupabaseClient.from.mockImplementation((table: string) => {
        expect(table).toBe('tests')
        return createSingleSelectResult({
          data: {
            id: 'test-1',
            classroom_id: 'classroom-1',
            status: 'draft',
            title: 'Unit Test',
            show_results: false,
            position: 0,
            points_possible: 10,
            include_in_final: true,
            created_by: 'teacher-2',
            created_at: '2026-03-01T00:00:00.000Z',
            updated_at: '2026-03-01T00:00:00.000Z',
            classrooms: {
              id: 'classroom-1',
              teacher_id: 'teacher-2',
              archived_at: null,
            },
          },
          error: null,
        })
      })

      await expect(assertTeacherOwnsTest('teacher-1', 'test-1')).resolves.toEqual({
        ok: false,
        status: 403,
        error: 'Forbidden',
      })
    })

    it('returns 403 when a student tries to access a test in an archived classroom', async () => {
      mockSupabaseClient.from.mockImplementation((table: string) => {
        expect(table).toBe('tests')
        return createSingleSelectResult({
          data: {
            id: 'test-1',
            classroom_id: 'classroom-1',
            status: 'active',
            title: 'Unit Test',
            show_results: false,
            position: 0,
            points_possible: 10,
            include_in_final: true,
            created_by: 'teacher-1',
            created_at: '2026-03-01T00:00:00.000Z',
            updated_at: '2026-03-01T00:00:00.000Z',
            classrooms: {
              id: 'classroom-1',
              teacher_id: 'teacher-1',
              archived_at: '2026-03-03T00:00:00.000Z',
            },
          },
          error: null,
        })
      })

      await expect(assertStudentCanAccessTest('student-1', 'test-1')).resolves.toEqual({
        ok: false,
        status: 403,
        error: 'Classroom is archived',
      })
    })

    it('returns the test when the student is enrolled', async () => {
      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'tests') {
          return createSingleSelectResult({
            data: {
              id: 'test-1',
              classroom_id: 'classroom-1',
              status: 'active',
              title: 'Unit Test',
              show_results: false,
              position: 0,
              points_possible: 10,
              include_in_final: true,
              created_by: 'teacher-1',
              created_at: '2026-03-01T00:00:00.000Z',
              updated_at: '2026-03-01T00:00:00.000Z',
              classrooms: {
                id: 'classroom-1',
                teacher_id: 'teacher-1',
                archived_at: null,
              },
            },
            error: null,
          })
        }

        expect(table).toBe('classroom_enrollments')
        return createSingleSelectResult({ data: { id: 'enrollment-1' }, error: null })
      })

      const result = await assertStudentCanAccessTest('student-1', 'test-1')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.test.id).toBe('test-1')
        expect(result.test.classrooms.teacher_id).toBe('teacher-1')
      }
    })
  })

  describe('schema drift helpers', () => {
    it('detects missing test attempt return columns from postgres and postgrest errors', () => {
      expect(
        isMissingTestAttemptReturnColumnsError({
          code: '42703',
          message: 'column returned_at does not exist',
        })
      ).toBe(true)

      expect(
        isMissingTestAttemptReturnColumnsError({
          code: 'PGRST204',
          details: 'Could not find the returned_by column',
        })
      ).toBe(true)

      expect(isMissingTestAttemptReturnColumnsError({ code: '22000', message: 'different issue' })).toBe(false)
    })

    it('detects missing AI grading columns only when the error mentions those fields', () => {
      expect(
        isMissingTestResponseAiColumnsError({
          code: '42703',
          message: 'column ai_grading_basis does not exist',
        })
      ).toBe(true)

      expect(
        isMissingTestResponseAiColumnsError({
          code: 'PGRST204',
          hint: 'ai_reference_answers missing from schema cache',
        })
      ).toBe(true)

      expect(isMissingTestResponseAiColumnsError({ code: '42703', message: 'column score does not exist' })).toBe(
        false
      )
    })
  })
})
