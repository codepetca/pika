import { describe, expect, it } from 'vitest'
import {
  clearTestOpenGradesSchema,
  saveStudentTestGradesSchema,
  saveTestResponseGradeSchema,
} from '@/lib/validations/test-grading'

const questionGradingSnapshot = {
  test_title: 'Unit Test',
  question_text: 'Explain the result.',
  points: 5,
  response_monospace: false,
  answer_key: 'Use the expected result.',
  sample_solution: null,
}

const gradingProvenance = {
  schemaVersion: 'test-grading-provenance-v1',
  gradingRequestId: '10000000-0000-4000-8000-000000000001',
  provider: 'openai',
  model: 'gpt-5-nano',
  policyVersion: 'pika-test-open-response-policy-v1',
  promptVersion: 'pika-test-open-response-manual-prompt-v1',
  gradingProfileVersion: 'pika-test-open-response-v1',
  rubricVersion: 'pika-test-open-response-rubric-v1',
  operation: 'single',
  batchSize: 1,
  providerRequestCount: 1,
  tokenUsage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
}

describe('saveStudentTestGradesSchema', () => {
  it('normalizes grade values, response revisions, and AI audit metadata', () => {
    expect(saveStudentTestGradesSchema.parse({
      grades: [
        {
          question_id: ' question-1 ',
          response_id: ' response-1 ',
          expected_response_revision: 4,
          score: 1.235,
          feedback: ' Useful feedback ',
          ai_grading_basis: 'generated_reference',
          ai_reference_answers: [' Reference one ', '', 'Reference two'],
          ai_model: ' gpt-5-nano ',
          question_grading_snapshot: questionGradingSnapshot,
          ai_provenance_token: 'signed-token',
          ai_suggested_score: 1.2,
          ai_suggested_feedback: 'Original AI feedback',
          ai_grading_provenance: gradingProvenance,
        },
      ],
    })).toEqual({
      grades: [
        {
          question_id: 'question-1',
          response_id: 'response-1',
          expected_response_revision: 4,
          score: 1.24,
          feedback: 'Useful feedback',
          clear_grade: false,
          ai_grading_basis: 'generated_reference',
          ai_reference_answers: ['Reference one', 'Reference two'],
          ai_model: 'gpt-5-nano',
          question_grading_snapshot: questionGradingSnapshot,
          ai_provenance_token: 'signed-token',
          ai_suggested_score: 1.2,
          ai_suggested_feedback: 'Original AI feedback',
          ai_grading_provenance: gradingProvenance,
        },
      ],
    })
  })

  it('normalizes clears without reading score or feedback', () => {
    expect(saveStudentTestGradesSchema.parse({
      grades: [
        {
          question_id: 'question-1',
          response_id: 'response-1',
          expected_response_revision: 2,
          clear_grade: true,
          score: { malformed: true },
          feedback: ['ignored'],
          ai_grading_basis: 'teacher_key',
          ai_reference_answers: ['ignored for teacher key'],
          ai_model: '',
        },
      ],
    })).toEqual({
      grades: [
        {
          question_id: 'question-1',
          response_id: 'response-1',
          expected_response_revision: 2,
          score: null,
          feedback: null,
          clear_grade: true,
          ai_grading_basis: null,
          ai_reference_answers: null,
          ai_model: null,
          question_grading_snapshot: null,
          ai_provenance_token: null,
          ai_suggested_score: null,
          ai_suggested_feedback: null,
          ai_grading_provenance: null,
        },
      ],
    })
  })

  it.each([
    [{}, 'grades array is required'],
    [{ grades: [] }, 'grades array is required'],
    [{ grades: [null] }, 'Invalid grade payload'],
    [{ grades: [{ question_id: ' ', score: 1 }] }, 'Invalid grade payload'],
    [{ grades: [{ question_id: 'q1', response_id: 'r1', expected_response_revision: 1, score: -1 }] }, 'Invalid grade payload'],
    [{ grades: [{ question_id: 'q1', response_id: 'r1', expected_response_revision: 1, score: '1' }] }, 'Invalid grade payload'],
    [{ grades: [{ question_id: 'q1', response_id: 'r1', expected_response_revision: 1, score: null }] }, 'Invalid grade payload'],
    [{ grades: [{ question_id: 'q1', response_id: 'r1', expected_response_revision: 1, score: true }] }, 'Invalid grade payload'],
    [{ grades: [{ question_id: 'q1', response_id: 'r1', expected_response_revision: 0, score: 1 }] }, 'Invalid grade payload'],
    [{ grades: [{ question_id: 'q1', response_id: 'r1', expected_response_revision: 1, score: 1, clear_grade: 'yes' }] }, 'Invalid grade payload'],
    [{ grades: [{ question_id: 'q1', response_id: 'r1', expected_response_revision: 1, score: 1, ai_grading_basis: 'unknown' }] }, 'Invalid grade payload'],
    [{ grades: [{ question_id: 'q1', response_id: 'r1', expected_response_revision: 1, score: 1, ai_grading_basis: 'teacher_key' }] }, 'Invalid grade payload'],
    [{ grades: [{ question_id: 'q1', response_id: 'r1', expected_response_revision: 1, score: 1, ai_grading_basis: 'generated_reference' }] }, 'Invalid grade payload'],
    [{
      grades: [{
        question_id: 'q1',
        response_id: 'r1',
        expected_response_revision: 1,
        score: 1,
        ai_grading_basis: 'generated_reference',
        ai_reference_answers: ['one', 'two', 'three', 'four'],
      }],
    }, 'Invalid grade payload'],
    [{ grades: [{ question_id: 'q1', response_id: 'r1', expected_response_revision: 1, score: 1, ai_model: 5 }] }, 'Invalid grade payload'],
    [{ grades: [{ question_id: 'q1', response_id: 'r1', expected_response_revision: 1, score: 1, feedback: 'x'.repeat(10001) }] }, 'Invalid grade payload'],
    [{ grades: [{ question_id: 'q1', response_id: 'r1', expected_response_revision: 1, score: 1, ai_grading_basis: 'teacher_key', ai_model: 'x'.repeat(201) }] }, 'Invalid grade payload'],
    [{ grades: [{ question_id: 'q1', response_id: 'r1', expected_response_revision: 1, score: 1, ai_grading_basis: 'teacher_key', ai_model: 'gpt-5-nano', question_grading_snapshot: { ...questionGradingSnapshot, unexpected: true } }] }, 'Invalid grade payload'],
    [{
      grades: [{
        question_id: 'q1',
        response_id: 'r1',
        expected_response_revision: 1,
        score: 1,
        ai_grading_basis: 'generated_reference',
        ai_reference_answers: ['x'.repeat(10001)],
        ai_model: 'gpt-5-nano',
      }],
    }, 'Invalid grade payload'],
  ])('rejects invalid request %#', (input, expectedMessage) => {
    const result = saveStudentTestGradesSchema.safeParse(input)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(expectedMessage)
    }
  })

  it('rejects duplicate question ids after trimming', () => {
    const result = saveStudentTestGradesSchema.safeParse({
      grades: [
        { question_id: 'question-1', response_id: 'response-1', expected_response_revision: 1, score: 1 },
        { question_id: ' question-1 ', response_id: 'response-2', expected_response_revision: 1, score: 2 },
      ],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Duplicate question_id in grades payload')
    }
  })

  it('rejects duplicate response ids', () => {
    const result = saveStudentTestGradesSchema.safeParse({
      grades: [
        { question_id: 'question-1', response_id: 'response-1', expected_response_revision: 1, score: 1 },
        { question_id: 'question-2', response_id: ' response-1 ', expected_response_revision: 1, score: 2 },
      ],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Duplicate response_id in grades payload')
    }
  })
})

describe('saveTestResponseGradeSchema', () => {
  it('parses one revision-aware manual grade', () => {
    expect(saveTestResponseGradeSchema.parse({
      expected_response_revision: 3,
      score: 2.126,
      feedback: ' Reviewed ',
    })).toEqual({
      expected_response_revision: 3,
      score: 2.13,
      feedback: 'Reviewed',
      clear_grade: false,
      ai_grading_basis: undefined,
      ai_reference_answers: undefined,
      ai_model: undefined,
      question_grading_snapshot: undefined,
      ai_provenance_token: undefined,
      ai_suggested_score: undefined,
      ai_suggested_feedback: undefined,
    })
  })
})

describe('clearTestOpenGradesSchema', () => {
  it('trims, deduplicates, and bounds student ids', () => {
    expect(clearTestOpenGradesSchema.parse({
      student_ids: [' student-1 ', 'student-1', 'student-2'],
      responses: [{ response_id: ' response-1 ', expected_response_revision: 3 }],
    })).toEqual({
      student_ids: ['student-1', 'student-2'],
      responses: [{ response_id: 'response-1', expected_response_revision: 3 }],
    })
  })

  it.each([
    {},
    { student_ids: [], responses: [] },
    { student_ids: ['student-1', 2], responses: [] },
    { student_ids: ['student-1'] },
    { student_ids: ['student-1'], responses: [{ response_id: 'response-1', expected_response_revision: 0 }] },
    { student_ids: ['student-1'], responses: [
      { response_id: 'response-1', expected_response_revision: 1 },
      { response_id: 'response-1', expected_response_revision: 1 },
    ] },
    { student_ids: Array.from({ length: 101 }, (_, index) => `student-${index}`), responses: [] },
  ])('rejects an invalid clear request %#', (input) => {
    expect(clearTestOpenGradesSchema.safeParse(input).success).toBe(false)
  })
})
