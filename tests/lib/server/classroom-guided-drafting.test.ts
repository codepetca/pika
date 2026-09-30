import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateClassroomGuidedDraft } from '@/lib/server/course-blueprint-guided-drafting'
import { parseClassroomGuidedDraft } from '@/lib/server/classroom-guided-draft-create'
import type { ClassroomAuthoringGuidance } from '@/lib/server/classroom-authoring-guidance'

const unitId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const source: ClassroomAuthoringGuidance = {
  blueprint_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  content_version_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  content_version_number: 1,
  source_blueprint_version_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  source_blueprint_version_number: 2,
  source_draft_revision: 7,
  guidance: {
    course_expectations_markdown: 'Frozen course guidance',
    assignment_guidance_markdown: 'Frozen assignment guidance',
    test_guidance_markdown: 'Frozen test guidance',
    unit_exceptions: [{
      id: unitId, unit_label: 'Unit 1', assignment_guidance_markdown: 'Frozen unit assignment',
      test_guidance_markdown: 'Frozen unit test',
    }],
  },
  course: {
    title: 'Frozen course', subject: 'Computer Science', grade_level: '11',
    outline_markdown: 'Frozen outline',
    assignment_titles: ['Existing assignment'], test_titles: ['Existing test'],
  },
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('frozen classroom guided drafting', () => {
  it('creates one assignment with the full Karel task and reference despite headings, dividers, and fenced code', async () => {
    const instructions = [
      '# Verification — Unit 1 Karel assignment guidance',
      '',
      '## Task',
      'Write a Java SuperKarel program for a one-row corridor.',
      '',
      '## Deliverable (what you will submit)',
      '- A Java method with the signature `public void run()`.',
      '',
      '## Assessment criteria (10 points total)',
      '- Functional correctness: 7 points',
      '',
      '---',
      '',
      '## Coding / Karel reference (shared language details)',
      'Use `frontIsBlocked()` and `takeBall()`.',
      '',
      '### Submission Requirements',
      'This is student-facing prose, not a submission requirement row.',
      '## Instructions',
      'Points: 999 is an example of a metadata-looking line.',
      'Due Days: 999',
      '',
      '````java',
      '## Code heading must stay verbatim',
      '---',
      '### Submission Requirements',
      'Points: 999',
      '```',
      '````',
      '',
      '~~~java',
      '## A second protected fence',
      '---',
      '~~~',
    ].join('\n')
    vi.stubEnv('OPENAI_API_KEY', 'fake-key')
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'completed', output_text: JSON.stringify({
        title: 'Verification — Unit 1 Karel assignment guidance',
        instructions_markdown: instructions,
        points_possible: 10,
      }) }),
    })))

    const result = await generateClassroomGuidedDraft({ source, target: 'assignments', prompt: '' })
    const parsed = parseClassroomGuidedDraft('assignments', result.content)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok || parsed.draft.target !== 'assignments') return
    expect(parsed.draft.title).toBe('Verification — Unit 1 Karel assignment guidance')
    expect(parsed.draft.pointsPossible).toBe(10)
    expect(result.content).toContain('[DRAFT]')
    expect(parsed.draft.instructionsMarkdown).toContain('### Task')
    expect(parsed.draft.instructionsMarkdown).toContain('### Coding / Karel reference')
    expect(parsed.draft.instructionsMarkdown).toContain('***')
    expect(parsed.draft.instructionsMarkdown).toContain('#### Submission Requirements')
    expect(parsed.draft.instructionsMarkdown).toContain('\\Points: 999 is an example')
    expect(parsed.draft.instructionsMarkdown).toContain('\\Due Days: 999')
    expect(parsed.draft.instructionsMarkdown).toContain('````java\n## Code heading must stay verbatim\n---\n### Submission Requirements\nPoints: 999\n```\n````')
    expect(parsed.draft.instructionsMarkdown).toContain('~~~java\n## A second protected fence\n---\n~~~')
    expect(parsed.draft.instructionsMarkdown).toContain('Use `frontIsBlocked()` and `takeBall()`.')
  })

  it('supplies only frozen Version context and returns standalone parseable assignment Markdown', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'fake-key')
    const fetchMock = vi.fn(async (_url: string, options: RequestInit) => ({
      ok: true,
      json: async () => ({
        status: 'completed',
        output_text: JSON.stringify({
          title: 'New assignment', instructions_markdown: 'Write a program.', points_possible: 20,
        }),
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateClassroomGuidedDraft({
      source: { ...source, course: { ...source.course,
        assignment_titles: Array.from({ length: 41 }, (_, index) => `Assignment ${index + 1}`),
      } }, target: 'assignments', prompt: 'Create practice', unitExceptionId: unitId,
    })
    const request = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    const input = request.input[1].content[0].text as string
    expect(input).toContain('Frozen course guidance')
    expect(input).toContain('Frozen unit assignment')
    expect(input).toContain('Frozen outline')
    expect(input).toContain('Assignment 40')
    expect(input).not.toContain('Assignment 41')
    expect(input).toContain('Content Version 1, Guidance Version 2, Draft revision 7')
    expect(input).not.toContain('Live Draft')
    expect(result.guidance).toEqual(expect.objectContaining({
      content_version_id: source.content_version_id,
      source_blueprint_version_id: source.source_blueprint_version_id,
      source_blueprint_version_number: 2,
      source_draft_revision: 7,
      unit_exception_id: unitId, trial: false,
    }))
    const parsed = parseClassroomGuidedDraft('assignments', result.content)
    expect(parsed.ok).toBe(true)
    if (parsed.ok && parsed.draft.target === 'assignments') {
      expect(parsed.draft.title).toBe('New assignment')
      expect(parsed.draft.instructionsMarkdown).toBe('Write a program.')
    }
  })

  it('adds generic Instructions first and preserves questions in standalone test Markdown', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'fake-key')
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        status: 'completed',
        output_text: JSON.stringify({
          title: 'Unit test', is_coding_test: true,
          reference_documents: [{ title: 'Python', content_markdown: '# Python\n\nUse `print()`.' }],
          questions: [{
            question_type: 'open_response', question_text: 'Write a function.',
            options: [], correct_option: null, answer_key: 'Checks all cases',
            sample_solution: 'def solve():\n    return 1', points: 5,
          }],
        }),
      }),
    })))

    const result = await generateClassroomGuidedDraft({ source, target: 'tests', prompt: '' })
    const parsed = parseClassroomGuidedDraft('tests', result.content)
    expect(parsed.ok).toBe(true)
    if (parsed.ok && parsed.draft.target === 'tests') {
      expect(parsed.draft.draftContent.questions).toHaveLength(1)
      expect(parsed.draft.documents.map((doc) => doc.title)).toEqual(['Instructions', 'Python'])
    }
  })
})
