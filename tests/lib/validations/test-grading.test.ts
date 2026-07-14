import { describe, expect, it } from 'vitest'
import { saveStudentTestGradesSchema } from '@/lib/validations/test-grading'

describe('saveStudentTestGradesSchema', () => {
  it('normalizes grade values and AI audit metadata', () => {
    expect(saveStudentTestGradesSchema.parse({
      grades: [
        {
          question_id: ' question-1 ',
          score: '1.235',
          feedback: ' Useful feedback ',
          ai_grading_basis: 'generated_reference',
          ai_reference_answers: [' Reference one ', '', 'Reference two'],
          ai_model: ' gpt-5-nano ',
        },
      ],
    })).toEqual({
      grades: [
        {
          question_id: 'question-1',
          score: 1.24,
          feedback: 'Useful feedback',
          clear_grade: false,
          ai_grading_basis: 'generated_reference',
          ai_reference_answers: ['Reference one', 'Reference two'],
          ai_model: 'gpt-5-nano',
        },
      ],
    })
  })

  it('normalizes clears without reading score or feedback', () => {
    expect(saveStudentTestGradesSchema.parse({
      grades: [
        {
          question_id: 'question-1',
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
          score: null,
          feedback: null,
          clear_grade: true,
          ai_grading_basis: 'teacher_key',
          ai_reference_answers: null,
          ai_model: null,
        },
      ],
    })
  })

  it('preserves null and empty-string score coercion to zero', () => {
    expect(saveStudentTestGradesSchema.parse({
      grades: [
        { question_id: 'question-1', score: null },
        { question_id: 'question-2', score: '' },
      ],
    }).grades.map((grade) => grade.score)).toEqual([0, 0])
  })

  it.each([
    [{}, 'grades array is required'],
    [{ grades: [] }, 'grades array is required'],
    [{ grades: [null] }, 'Invalid grade payload'],
    [{ grades: [{ question_id: ' ', score: 1 }] }, 'Invalid grade payload'],
    [{ grades: [{ question_id: 'q1', score: -1 }] }, 'Invalid grade payload'],
    [{ grades: [{ question_id: 'q1', score: 'not-a-number' }] }, 'Invalid grade payload'],
    [{ grades: [{ question_id: 'q1', score: 1, clear_grade: 'yes' }] }, 'Invalid grade payload'],
    [{ grades: [{ question_id: 'q1', score: 1, ai_grading_basis: 'unknown' }] }, 'Invalid grade payload'],
    [{ grades: [{ question_id: 'q1', score: 1, ai_grading_basis: 'generated_reference' }] }, 'Invalid grade payload'],
    [{
      grades: [{
        question_id: 'q1',
        score: 1,
        ai_grading_basis: 'generated_reference',
        ai_reference_answers: ['one', 'two', 'three', 'four'],
      }],
    }, 'Invalid grade payload'],
    [{ grades: [{ question_id: 'q1', score: 1, ai_model: 5 }] }, 'Invalid grade payload'],
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
        { question_id: 'question-1', score: 1 },
        { question_id: ' question-1 ', score: 2 },
      ],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Duplicate question_id in grades payload')
    }
  })
})
