import { describe, expect, it } from 'vitest'
import {
  aggregateSurveyResults,
  canStudentRespondToSurvey,
  getStudentSurveyStatus,
  normalizeSurveyQuestionInput,
  validateSurveyResponses,
} from '@/lib/surveys'
import { markdownToSurvey, surveyToMarkdown } from '@/lib/survey-markdown'
import type { Survey, SurveyQuestion, SurveyResponse } from '@/types'

function makeSurvey(overrides: Partial<Survey> = {}): Survey {
  return {
    id: 'survey-1',
    classroom_id: 'classroom-1',
    title: 'Project links',
    status: 'active',
    opens_at: '2026-01-01T00:00:00.000Z',
    show_results: true,
    dynamic_responses: false,
    position: 0,
    created_by: 'teacher-1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeQuestion(overrides: Partial<SurveyQuestion> = {}): SurveyQuestion {
  return {
    id: 'question-1',
    survey_id: 'survey-1',
    question_type: 'multiple_choice',
    question_text: 'Pick one',
    options: ['A', 'B'],
    response_max_chars: 500,
    position: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeResponse(overrides: Partial<SurveyResponse> = {}): SurveyResponse {
  return {
    id: 'response-1',
    survey_id: 'survey-1',
    question_id: 'question-1',
    student_id: 'student-1',
    selected_option: 0,
    response_text: null,
    submitted_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('survey utilities', () => {
  it('allows dynamic surveys to be updated while open', () => {
    const survey = makeSurvey({ dynamic_responses: true })

    expect(canStudentRespondToSurvey(survey, true, new Date('2026-01-02T00:00:00.000Z'))).toBe(true)
    expect(getStudentSurveyStatus(survey, true, new Date('2026-01-02T00:00:00.000Z'))).toBe('can_update')
    expect(getStudentSurveyStatus({ ...survey, show_results: false }, true, new Date('2026-01-02T00:00:00.000Z'))).toBe('can_update')
  })

  it('shows results after a dynamic survey is closed', () => {
    const survey = makeSurvey({ status: 'closed', dynamic_responses: true, show_results: true })

    expect(getStudentSurveyStatus(survey, true, new Date('2026-01-02T00:00:00.000Z'))).toBe('can_view_results')
  })

  it('locks non-dynamic surveys after a response', () => {
    const survey = makeSurvey({ dynamic_responses: false, show_results: false })

    expect(canStudentRespondToSurvey(survey, true, new Date('2026-01-02T00:00:00.000Z'))).toBe(false)
    expect(getStudentSurveyStatus(survey, true, new Date('2026-01-02T00:00:00.000Z'))).toBe('responded')
  })

  it('normalizes link questions without options', () => {
    const result = normalizeSurveyQuestionInput({
      question_type: 'link',
      question_text: 'Share your game',
      options: ['ignored'],
    })

    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.question.question_type).toBe('link')
      expect(result.question.options).toEqual([])
    }
  })

  it('validates multiple-choice, short-text, and link responses', () => {
    const questions = [
      makeQuestion({ id: 'mc', question_type: 'multiple_choice', options: ['Yes', 'No'] }),
      makeQuestion({ id: 'text', question_type: 'short_text', options: [], response_max_chars: 20 }),
      makeQuestion({ id: 'link', question_type: 'link', options: [], response_max_chars: 200 }),
    ]

    const result = validateSurveyResponses(questions, {
      mc: { question_type: 'multiple_choice', selected_option: 1 },
      text: { question_type: 'short_text', response_text: 'Looks good' },
      link: { question_type: 'link', response_text: 'https://example.com/game' },
    })

    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.responses.link).toEqual({
        question_type: 'link',
        response_text: 'https://example.com/game',
      })
    }
  })

  it('rejects invalid link responses', () => {
    const result = validateSurveyResponses(
      [makeQuestion({ id: 'link', question_type: 'link', options: [] })],
      { link: { question_type: 'link', response_text: 'not a url' } },
    )

    expect(result.valid).toBe(false)
  })

  it('aggregates multiple-choice counts and text response lists', () => {
    const questions = [
      makeQuestion({ id: 'mc', options: ['A', 'B'] }),
      makeQuestion({ id: 'text', question_type: 'short_text', options: [] }),
    ]
    const responses = [
      makeResponse({ id: 'r1', question_id: 'mc', selected_option: 0 }),
      makeResponse({ id: 'r2', question_id: 'mc', student_id: 'student-2', selected_option: 1 }),
      makeResponse({
        id: 'r3',
        question_id: 'text',
        student_id: 'student-1',
        selected_option: null,
        response_text: 'I found a resource',
      }),
    ]

    const results = aggregateSurveyResults(questions, responses)

    expect(results[0].counts).toEqual([1, 1])
    expect(results[1].responses).toHaveLength(1)
    expect(results[1].responses[0].response_text).toBe('I found a resource')
  })

  it('serializes survey markdown with multiple-choice, text, and link questions', () => {
    const markdown = surveyToMarkdown({
      survey: makeSurvey({ title: 'Project links', show_results: true, dynamic_responses: true }),
      questions: [
        makeQuestion({ id: 'mc', question_type: 'multiple_choice', question_text: 'Pick one', options: ['A', 'B'] }),
        makeQuestion({
          id: 'link',
          question_type: 'link',
          question_text: 'Share your game',
          options: [],
          response_max_chars: 2048,
        }),
      ],
    })

    expect(markdown).toContain('Title: Project links')
    expect(markdown).toContain('Dynamic Responses: true')
    expect(markdown).toContain('Type: multiple_choice')
    expect(markdown).toContain('Type: link')
    expect(markdown).toContain('Max Chars: 2048')
  })

  it('parses survey markdown into editable survey content', () => {
    const result = markdownToSurvey(`# Survey
Title: Project links
Show Results: true
Dynamic Responses: true

## Questions
### Question 1
ID: existing-mc
Type: multiple choice
Prompt:
Which engine did you use?
Options:
- Godot
- Unity

### Question 2
Type: link
Prompt:
Share your game.
Max Chars: 2048
`)

    expect(result.errors).toEqual([])
    expect(result.content).toEqual({
      title: 'Project links',
      show_results: true,
      dynamic_responses: true,
      questions: [
        {
          id: 'existing-mc',
          question_type: 'multiple_choice',
          question_text: 'Which engine did you use?',
          options: ['Godot', 'Unity'],
          response_max_chars: 500,
        },
        {
          question_type: 'link',
          question_text: 'Share your game.',
          options: [],
          response_max_chars: 2048,
        },
      ],
    })
  })

  it('returns survey markdown validation errors', () => {
    const result = markdownToSurvey(`# Survey
Title:

## Questions
### Question 1
Type: multiple_choice
Prompt:
Options:
- Only one
`)

    expect(result.content).toBeNull()
    expect(result.errors).toContain('Title is required')
    expect(result.errors).toContain('Question 1: Question text is required')
  })
})
