import { beforeEach, describe, expect, it, vi } from 'vitest'
import { exportClassroomArchive, importClassroomArchive } from '@/lib/server/classroom-archives'
import { makeQueryBuilder, makeSupabaseFromQueues } from '../../support/supabase'

let mockSupabase: any

const mockEncodeArchive = vi.fn(() => new Uint8Array([1, 2, 3]))
const mockDecodeArchive = vi.fn()
const mockAssertTeacherOwnsClassroom = vi.fn()
const mockHydrateClassroomRecord = vi.fn((row) => row)

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabase),
}))

vi.mock('@/lib/classroom-archive-package', () => ({
  encodeClassroomArchivePackage: (...args: any[]) => mockEncodeArchive(...args),
  decodeClassroomArchivePackage: (...args: any[]) => mockDecodeArchive(...args),
}))

vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherOwnsClassroom: (...args: any[]) => mockAssertTeacherOwnsClassroom(...args),
  hydrateClassroomRecord: (...args: any[]) => mockHydrateClassroomRecord(...args),
}))

describe('classroom-archives server helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAssertTeacherOwnsClassroom.mockResolvedValue({
      ok: true,
      classroom: { id: 'c-1', teacher_id: 'teacher-1', archived_at: null },
    })
  })

  it('exports a classroom archive package with the collected snapshot', async () => {
    mockSupabase = makeSupabaseFromQueues({
      classrooms: [
        makeQueryBuilder({
          data: {
            id: 'c-1',
            title: 'CS 11',
            class_code: 'ABC123',
            term_label: 'Sem 1',
            teacher_id: 'teacher-1',
            source_blueprint_origin: 'blueprint:b-1',
          },
          error: null,
        }),
      ],
      class_days: [makeQueryBuilder({ data: [{ id: 'cd-1', classroom_id: 'c-1' }], error: null })],
      entries: [makeQueryBuilder({ data: [{ id: 'e-1', classroom_id: 'c-1' }], error: null })],
      lesson_plans: [makeQueryBuilder({ data: [{ id: 'lp-1', classroom_id: 'c-1' }], error: null })],
      classroom_resources: [makeQueryBuilder({ data: { id: 'r-1', classroom_id: 'c-1' }, error: null })],
      classroom_enrollments: [makeQueryBuilder({ data: [{ id: 'en-1', classroom_id: 'c-1' }], error: null })],
      assignments: [makeQueryBuilder({ data: [{ id: 'a-1', classroom_id: 'c-1' }], error: null })],
      quizzes: [makeQueryBuilder({ data: [{ id: 'q-1', classroom_id: 'c-1' }], error: null })],
      tests: [makeQueryBuilder({ data: [{ id: 't-1', classroom_id: 'c-1' }], error: null })],
      announcements: [makeQueryBuilder({ data: [{ id: 'ann-1', classroom_id: 'c-1' }], error: null })],
      gradebook_settings: [makeQueryBuilder({ data: { classroom_id: 'c-1' }, error: null })],
      assignment_docs: [makeQueryBuilder({ data: [{ id: 'ad-1', assignment_id: 'a-1' }], error: null })],
      quiz_questions: [makeQueryBuilder({ data: [{ id: 'qq-1', quiz_id: 'q-1' }], error: null })],
      quiz_responses: [makeQueryBuilder({ data: [{ id: 'qr-1', quiz_id: 'q-1' }], error: null })],
      test_questions: [makeQueryBuilder({ data: [{ id: 'tq-1', test_id: 't-1' }], error: null })],
      test_attempts: [makeQueryBuilder({ data: [{ id: 'ta-1', test_id: 't-1' }], error: null })],
      test_responses: [makeQueryBuilder({ data: [{ id: 'tr-1', test_id: 't-1' }], error: null })],
      assessment_drafts: [makeQueryBuilder({ data: [{ id: 'draft-1', classroom_id: 'c-1' }], error: null })],
      announcement_reads: [makeQueryBuilder({ data: [{ id: 'ar-1', announcement_id: 'ann-1' }], error: null })],
      assignment_doc_history: [makeQueryBuilder({ data: [{ id: 'adh-1', assignment_doc_id: 'ad-1' }], error: null })],
      assignment_feedback_entries: [makeQueryBuilder({ data: [{ id: 'afe-1', assignment_id: 'a-1' }], error: null })],
      test_attempt_history: [makeQueryBuilder({ data: [{ id: 'tah-1', test_attempt_id: 'ta-1' }], error: null })],
    })

    const result = await exportClassroomArchive('teacher-1', 'c-1')

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        manifest: expect.objectContaining({
          classroom_title: 'CS 11',
          class_code: 'ABC123',
          source_blueprint_origin: 'blueprint:b-1',
        }),
        archive: expect.any(Uint8Array),
      })
    )
    expect(mockEncodeArchive).toHaveBeenCalledWith(expect.objectContaining({
      manifest: expect.objectContaining({ classroom_title: 'CS 11' }),
      snapshot: expect.objectContaining({
        assignments: [{ id: 'a-1', classroom_id: 'c-1' }],
        assessment_drafts: [{ id: 'draft-1', classroom_id: 'c-1' }],
      }),
    }))
  })

  it('validates and restores a classroom archive snapshot', async () => {
    mockDecodeArchive.mockReturnValueOnce(null)
    await expect(importClassroomArchive('teacher-1', new Uint8Array([9]))).resolves.toEqual({
      ok: false,
      status: 400,
      error: 'Invalid classroom archive package',
    })

    mockDecodeArchive.mockReturnValueOnce({
      snapshot: {
        classroom: { id: 'c-1', title: 'CS 11', class_code: 'ABC123' },
        class_days: [{ id: 'cd-1', classroom_id: 'c-1' }],
        entries: [{ id: 'e-1', classroom_id: 'c-1' }],
        lesson_plans: [{ id: 'lp-1', classroom_id: 'c-1' }],
        classroom_resources: { id: 'r-1', classroom_id: 'c-1' },
        classroom_enrollments: [{ id: 'en-1', classroom_id: 'c-1' }],
        assignments: [{ id: 'a-1', classroom_id: 'c-1' }],
        assignment_docs: [{ id: 'ad-1', assignment_id: 'a-1' }],
        assignment_doc_history: [{ id: 'adh-1', assignment_doc_id: 'ad-1' }],
        assignment_feedback_entries: [{ id: 'afe-1', assignment_id: 'a-1' }],
        quizzes: [{ id: 'q-1', classroom_id: 'c-1' }],
        quiz_questions: [{ id: 'qq-1', quiz_id: 'q-1' }],
        quiz_responses: [{ id: 'qr-1', quiz_id: 'q-1', question_id: 'qq-1' }],
        tests: [{ id: 't-1', classroom_id: 'c-1' }],
        test_questions: [{ id: 'tq-1', test_id: 't-1' }],
        test_attempts: [{ id: 'ta-1', test_id: 't-1' }],
        test_attempt_history: [{ id: 'tah-1', test_attempt_id: 'ta-1' }],
        test_responses: [{ id: 'tr-1', test_id: 't-1', question_id: 'tq-1' }],
        assessment_drafts: [{ id: 'draft-1', classroom_id: 'c-1', assessment_type: 'quiz', assessment_id: 'q-1' }],
        announcements: [{ id: 'ann-1', classroom_id: 'c-1' }],
        announcement_reads: [{ id: 'ar-1', announcement_id: 'ann-1' }],
        gradebook_settings: { classroom_id: 'c-1' },
      },
    })

    const okBuilder = () => makeQueryBuilder({ data: null, error: null })
    mockSupabase = makeSupabaseFromQueues({
      classrooms: [
        okBuilder(),
        makeQueryBuilder({
          data: { id: 'restored', title: 'CS 11 (Restored)', class_code: 'XYZ999', archived_at: '2026-04-19T00:00:00Z' },
          error: null,
        }),
      ],
      class_days: [okBuilder()],
      entries: [okBuilder()],
      lesson_plans: [okBuilder()],
      classroom_resources: [okBuilder()],
      classroom_enrollments: [okBuilder()],
      assignments: [okBuilder()],
      assignment_docs: [okBuilder()],
      assignment_doc_history: [okBuilder()],
      assignment_feedback_entries: [okBuilder()],
      quizzes: [okBuilder()],
      quiz_questions: [okBuilder()],
      quiz_responses: [okBuilder()],
      tests: [okBuilder()],
      test_questions: [okBuilder()],
      test_attempts: [okBuilder()],
      test_attempt_history: [okBuilder()],
      test_responses: [okBuilder()],
      assessment_drafts: [okBuilder()],
      announcements: [okBuilder()],
      announcement_reads: [okBuilder()],
      gradebook_settings: [okBuilder()],
    })

    const result = await importClassroomArchive('teacher-1', new Uint8Array([1, 2, 3]))

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        classroom: expect.objectContaining({ title: 'CS 11 (Restored)' }),
      })
    )
  })
})
