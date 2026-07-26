import { describe, expect, it } from 'vitest'
import {
  courseBlueprintSurveysToMarkdown,
  markdownToCourseBlueprintSurveys,
} from '@/lib/course-blueprint-surveys'

describe('course Blueprint surveys Markdown', () => {
  it('round-trips reusable survey settings, questions, and identity', () => {
    const survey = {
      artifact_id: '10000000-0000-4000-8000-000000000000',
      title: 'Unit reflection',
      show_results: false,
      dynamic_responses: true,
      position: 4,
      questions_json: [
        {
          id: '20000000-0000-4000-8000-000000000000',
          question_type: 'multiple_choice' as const,
          question_text: 'How confident are you?',
          options: ['Not yet', 'Ready'],
          response_max_chars: 500,
          position: 0,
        },
        {
          id: '30000000-0000-4000-8000-000000000000',
          question_type: 'short_text' as const,
          question_text: 'What should we revisit?',
          options: [],
          response_max_chars: 800,
          position: 1,
        },
      ],
    }
    const parsed = markdownToCourseBlueprintSurveys(
      courseBlueprintSurveysToMarkdown([survey]),
      [],
      { requireArtifactIds: true, requirePositions: true }
    )

    expect(parsed.errors).toEqual([])
    expect(parsed.surveys).toEqual([survey])
  })

  it('rejects multiple-choice questions without two options', () => {
    const parsed = markdownToCourseBlueprintSurveys(
      [
        '# Survey: Reflection',
        'Artifact ID: 10000000-0000-4000-8000-000000000000',
        'Classwork Position: 2',
        'Show Results: true',
        'Dynamic Responses: false',
        '',
        '## Question 1',
        'ID: 20000000-0000-4000-8000-000000000000',
        'Type: multiple_choice',
        'Max Chars: 500',
        'Prompt:',
        'Choose one.',
        'Options:',
        '- Only one',
      ].join('\n'),
      [],
      { requireArtifactIds: true, requirePositions: true }
    )

    expect(parsed.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('at least two Options'),
    ]))
  })
})
