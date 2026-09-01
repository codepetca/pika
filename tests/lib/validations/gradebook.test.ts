import { describe, expect, it } from 'vitest'
import {
  gradebookCategoriesPutSchema,
  gradebookPatchSchema,
  gradebookQuerySchema,
} from '@/lib/validations/gradebook'

describe('gradebookQuerySchema', () => {
  it('normalizes an optional selected student while preserving the classroom id', () => {
    expect(gradebookQuerySchema.parse({ classroom_id: ' classroom-1 ', student_id: ' student-1 ' }))
      .toEqual({ classroom_id: ' classroom-1 ', student_id: 'student-1' })
    expect(gradebookQuerySchema.parse({ classroom_id: 'classroom-1', student_id: '' }))
      .toEqual({ classroom_id: 'classroom-1', student_id: null })
  })

  it('requires a classroom id', () => {
    expect(() => gradebookQuerySchema.parse({ classroom_id: '', student_id: null }))
      .toThrow('classroom_id is required')
  })
})

describe('gradebookPatchSchema', () => {
  it('parses an assessment update and preserves compatibility coercion', () => {
    expect(gradebookPatchSchema.parse({
      classroom_id: 'classroom-1',
      assessment_type: 'assignment',
      assessment_id: ' assignment-1 ',
      gradebook_weight: '25',
    })).toEqual({
      kind: 'assessment_weight',
      classroomId: 'classroom-1',
      assessmentType: 'assignment',
      assessmentId: 'assignment-1',
      gradebookWeight: 25,
    })
  })

  it('parses an assessment category and weight update', () => {
    expect(gradebookPatchSchema.parse({
      classroom_id: 'classroom-1',
      assessment_type: 'test',
      assessment_id: 'test-1',
      gradebook_category_id: '10000000-0000-4000-8000-000000000002',
      gradebook_weight: 25,
    })).toEqual({
      kind: 'assessment_details',
      classroomId: 'classroom-1',
      assessmentType: 'test',
      assessmentId: 'test-1',
      gradebookCategoryId: '10000000-0000-4000-8000-000000000002',
      gradebookWeight: 25,
    })
  })

  it.each([
    [{ assessment_type: 'quiz', assessment_id: 'a1', gradebook_weight: 10 }, 'assessment_type must be assignment or test'],
    [{ assessment_type: 'test', assessment_id: ' ', gradebook_weight: 10 }, 'assessment_id is required'],
    [{ assessment_type: 'test', assessment_id: 't1' }, 'gradebook_weight must be an integer 1-999'],
    [{ assessment_type: 'test', assessment_id: 't1', gradebook_weight: 1.5 }, 'gradebook_weight must be an integer 1-999'],
    [{ assessment_type: 'test', assessment_id: 't1', gradebook_weight: 0 }, 'gradebook_weight must be an integer 1-999'],
    [{ assessment_type: 'test', assessment_id: 't1', gradebook_weight: 1000 }, 'gradebook_weight must be an integer 1-999'],
    [{ assessment_type: 'test', assessment_id: ['t1'], gradebook_weight: 10 }, 'assessment_id is required'],
    [{ assessment_type: 'test', assessment_id: 't1', gradebook_weight: true }, 'gradebook_weight must be an integer 1-999'],
    [{ assessment_type: 'test', assessment_id: 't1', gradebook_weight: [10] }, 'gradebook_weight must be an integer 1-999'],
    [{ assessment_type: 'test', assessment_id: 't1', gradebook_weight: '1e2' }, 'gradebook_weight must be an integer 1-999'],
  ])('rejects invalid assessment payload %#', (fields, message) => {
    const result = gradebookPatchSchema.safeParse({ classroom_id: 'classroom-1', ...fields })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.message).toBe(message)
  })

  it('keeps legacy category updates distinct and gives assessment fields precedence', () => {
    expect(gradebookPatchSchema.parse({ classroom_id: 'c1', assignments_weight: 50 }))
      .toEqual({ kind: 'legacy_category_settings', classroomId: 'c1' })
    expect(gradebookPatchSchema.parse({
      classroom_id: 'c1',
      assignments_weight: 50,
      assessment_type: 'test',
      assessment_id: 't1',
      gradebook_weight: 20,
    })).toEqual({
      kind: 'assessment_weight',
      classroomId: 'c1',
      assessmentType: 'test',
      assessmentId: 't1',
      gradebookWeight: 20,
    })
  })

  it.each([null, [], 'payload', 10, {}, { classroom_id: 'c1', unknown: true }])(
    'rejects empty or non-object update input %#',
    (payload) => {
      const result = gradebookPatchSchema.safeParse(payload)
      expect(result.success).toBe(false)
    },
  )
})

describe('gradebookCategoriesPutSchema', () => {
  const category = (overrides: Record<string, unknown>) => ({
    id: '10000000-0000-4000-8000-000000000001',
    name: 'Term',
    percentage: 100,
    default_assessment_weight: 10,
    is_default: true,
    ...overrides,
  })

  it('accepts categories totaling 100 and assigns their array order', () => {
    const result = gradebookCategoriesPutSchema.parse({
      classroom_id: 'classroom-1',
      categories: [
        category({ percentage: 65 }),
        category({
          id: '10000000-0000-4000-8000-000000000002',
          name: 'Final',
          percentage: 35,
          is_default: false,
        }),
      ],
    })

    expect(result.categories.map((item) => item.position)).toEqual([0, 1])
  })

  it('rejects totals other than 100', () => {
    expect(() => gradebookCategoriesPutSchema.parse({
      classroom_id: 'classroom-1',
      categories: [category({ percentage: 65 })],
    })).toThrow('Category percentages must total 100')
  })

  it('rejects duplicate ids and percentages beyond two decimal places', () => {
    const result = gradebookCategoriesPutSchema.safeParse({
      classroom_id: 'classroom-1',
      categories: [
        category({ percentage: 65.001 }),
        category({ name: 'Final', percentage: 34.999, is_default: false }),
      ],
    })

    expect(result.success).toBe(false)
  })
})
