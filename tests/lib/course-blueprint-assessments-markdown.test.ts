import { describe, expect, it } from 'vitest'
import {
  courseBlueprintAssessmentsToMarkdown,
  markdownToCourseBlueprintAssessments,
} from '@/lib/course-blueprint-assessments-markdown'

describe('courseBlueprintAssessmentsToMarkdown', () => {
  it('falls back to assessment titles when content blobs are incomplete', () => {
    const markdown = courseBlueprintAssessmentsToMarkdown(
      [
        {
          id: 'assessment-1',
          assessment_type: 'quiz',
          title: 'Check-in quiz',
          content: {},
          documents: [],
          points_possible: 40,
          gradebook_weight: 35,
          include_in_final: false,
          position: 0,
        },
      ] as any,
      'quiz'
    )

    expect(markdown).toContain('Title: Check-in quiz')
    expect(markdown).toContain('## Questions')
  })

  it('round-trips assessment grading configuration', () => {
    const markdown = courseBlueprintAssessmentsToMarkdown([
      {
        assessment_type: 'test',
        title: 'Unit test',
        content: {
          title: 'Unit test',
          show_results: false,
          questions: [{
            id: '22222222-2222-4222-8222-222222222222',
            question_type: 'open_response',
            question_text: 'Explain it.',
            options: [],
            correct_option: null,
            answer_key: 'Explanation',
            sample_solution: null,
            points: 5,
            response_max_chars: 5000,
            response_monospace: false,
          }],
        },
        documents: [],
        points_possible: 40,
        gradebook_weight: 35,
        include_in_final: false,
        position: 0,
      },
    ], 'test')

    const parsed = markdownToCourseBlueprintAssessments(markdown, [], 'test')

    expect(parsed.errors).toEqual([])
    expect(parsed.assessments[0]).toEqual(expect.objectContaining({
      points_possible: 40,
      gradebook_weight: 35,
      include_in_final: false,
    }))
  })

  it('rejects invalid assessment grading configuration', () => {
    const parsed = markdownToCourseBlueprintAssessments(
      'Title: Unit test\nShow Results: false\nPoints Possible: -1\nGradebook Weight: 0\nInclude In Final: maybe\n\n## Questions',
      [],
      'test'
    )

    expect(parsed.errors).toEqual(expect.arrayContaining([
      'Test 1: Points Possible must be a non-negative integer or none',
      'Test 1: Gradebook Weight must be an integer from 1 to 999',
      'Test 1: Include In Final must be true or false',
    ]))
  })
})
