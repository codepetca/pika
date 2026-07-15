import { describe, expect, it } from 'vitest'
import {
  courseBlueprintAssessmentsBulkSchema,
  courseBlueprintAssignmentsBulkSchema,
  courseBlueprintLessonTemplatesBulkSchema,
  createClassroomFromBlueprintSchema,
  updateCourseBlueprintSchema,
} from '@/lib/validations/course-blueprints'

describe('course blueprint validations', () => {
  it('rejects publishing a planned site when the request clears the slug', () => {
    const result = updateCourseBlueprintSchema.safeParse({
      planned_site_slug: null,
      planned_site_published: true,
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('A planned site slug is required before publishing the planned site')
  })

  it('validates blueprint classroom theme colors', () => {
    expect(createClassroomFromBlueprintSchema.safeParse({ title: 'Math', themeColor: 'rose' }).success).toBe(true)
    expect(createClassroomFromBlueprintSchema.safeParse({ title: 'Math', themeColor: 'magenta' }).success).toBe(false)
  })

  it('validates complete blueprint assignment bulk payloads', () => {
    const result = courseBlueprintAssignmentsBulkSchema.safeParse({
      assignments: [{
        title: 'Diagnostic',
        instructions_markdown: 'Complete before class.',
        default_due_days: -2,
        default_due_time: '08:30',
        points_possible: 12.5,
        include_in_final: true,
        is_draft: true,
        position: 0,
      }],
    })

    expect(result.success).toBe(true)
    expect(courseBlueprintAssignmentsBulkSchema.safeParse({
      assignments: [{ title: 'Broken', default_due_time: '99:99' }],
    }).success).toBe(false)
  })

  it('reuses assessment and document domain validation at the blueprint boundary', () => {
    const result = courseBlueprintAssessmentsBulkSchema.safeParse({
      assessmentType: 'test',
      assessments: [{
        assessment_type: 'test',
        title: 'Unit test',
        content: {
          title: 'Unit test',
          show_results: false,
          questions: [{
            id: '22222222-2222-4222-8222-222222222222',
            question_type: 'open_response',
            question_text: 'Explain recursion.',
            options: [],
            correct_option: null,
            answer_key: 'A function calls itself.',
            sample_solution: null,
            points: 5,
            response_max_chars: 1000,
            response_monospace: false,
          }],
        },
        documents: [],
        position: 0,
      }],
    })

    expect(result.success).toBe(true)
    expect(courseBlueprintAssessmentsBulkSchema.safeParse({
      assessments: [{
        assessment_type: 'test',
        title: 'Broken',
        content: { title: 'Broken', show_results: false, questions: [{}] },
        documents: [],
        position: 0,
      }],
    }).success).toBe(false)
  })

  it('validates blueprint lesson template positions', () => {
    expect(courseBlueprintLessonTemplatesBulkSchema.safeParse({
      lesson_templates: [{ title: 'Lesson 1', content_markdown: 'Intro', position: 0 }],
    }).success).toBe(true)
    expect(courseBlueprintLessonTemplatesBulkSchema.safeParse({
      lesson_templates: [{ title: 'Lesson 1', content_markdown: 'Intro', position: -1 }],
    }).success).toBe(false)
  })
})
