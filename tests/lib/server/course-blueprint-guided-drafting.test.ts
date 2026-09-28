import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CourseBlueprintDetail } from '@/types'
import { generateCourseBlueprintGuidedDraft } from '@/lib/server/course-blueprint-guided-drafting'
import { markdownToCourseBlueprintAssessments } from '@/lib/course-blueprint-assessments-markdown'

const detail = {
  title: 'Introduction to Computer Studies',
  subject: 'Computer Studies',
  grade_level: 'Grade 11',
  outline_markdown: 'Unit 1: programming fundamentals',
  content_revision: 7,
  authoring_guidance: {
    course_expectations_markdown: 'Use the taught vocabulary.',
    assignment_guidance_markdown: 'Give a concrete submission checklist.',
    test_guidance_markdown: 'Keep question prompts short.',
    unit_exceptions: [{
      id: '11111111-1111-4111-8111-111111111111',
      unit_label: 'Unit 1',
      assignment_guidance_markdown: 'Use Python examples.',
      test_guidance_markdown: 'Use Karel examples.',
    }],
  },
  assignments: [],
  assessments: [],
} as unknown as CourseBlueprintDetail

function mockModel(output: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({
    status: 'completed',
    output_text: JSON.stringify(output),
  }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('OPENAI_API_KEY', 'test-only-key')
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('guided Blueprint drafting', () => {
  it('passes approved course and unit assignment rules into the model request', async () => {
    const fetchMock = mockModel({
      title: 'Python practice',
      instructions_markdown: 'Write a program.\n\nSubmit the code and a sample run.',
      points_possible: 20,
    })
    const result = await generateCourseBlueprintGuidedDraft({
      detail,
      target: 'assignments',
      prompt: 'Practice loops.',
      unitExceptionId: detail.authoring_guidance.unit_exceptions[0].id,
    })
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    const modelInput = request.input[1].content[0].text as string
    expect(modelInput).toContain('Use the taught vocabulary.')
    expect(modelInput).toContain('Give a concrete submission checklist.')
    expect(modelInput).toContain('Use Python examples.')
    expect(modelInput).not.toContain('Use Karel examples.')
    expect(result.guidance.blueprint_revision).toBe(7)
    expect(result.content).toContain('Python practice [DRAFT]')
  })

  it('puts general coding directions in the first reference and parses the draft', async () => {
    mockModel({
      title: 'Karel Unit 1',
      is_coding_test: true,
      reference_documents: [{
        title: 'Karel commands',
        content_markdown: '# Karel commands\n\n`move()` moves one step.',
      }],
      questions: [{
        question_type: 'multiple_choice',
        question_text: 'Which command moves Karel?',
        options: ['`move()`', '`turn()`'],
        correct_option: 0,
        answer_key: null,
        sample_solution: null,
        points: 1,
      }],
    })
    const result = await generateCourseBlueprintGuidedDraft({ detail, target: 'tests', prompt: '' })
    const parsed = markdownToCourseBlueprintAssessments(result.content, [], 'test')
    expect(parsed.errors).toEqual([])
    expect(parsed.assessments[0].documents.map((document) => document.title)).toEqual([
      'Instructions',
      'Karel commands',
    ])
    expect(parsed.assessments[0].content.questions[0].options[0]).toBe('`move()`')
  })

  it('uses proposed rules only for a temporary trial preview', async () => {
    const fetchMock = mockModel({
      title: 'Python practice',
      instructions_markdown: 'Submit a program.',
      points_possible: 10,
    })
    const proposed = {
      ...detail.authoring_guidance,
      course_expectations_markdown: 'Use the revised course convention.',
    }
    const result = await generateCourseBlueprintGuidedDraft({
      detail,
      target: 'assignments',
      prompt: '',
      trialGuidance: proposed,
    })
    const modelInput = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      .input[1].content[0].text as string
    expect(modelInput).toContain('Use the revised course convention.')
    expect(modelInput).not.toContain('Use the taught vocabulary.')
    expect(result.guidance.trial).toBe(true)
    expect(detail.authoring_guidance.course_expectations_markdown).toBe('Use the taught vocabulary.')
  })
})
