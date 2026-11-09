import { describe, expect, it } from 'vitest'
import { prepareClassworkContent } from '@/lib/server/classwork-authoring-drafts'

const assignment = {
  title: 'New title',
  instructions_markdown: 'Some instructions',
  due_at: '2026-11-10T04:59:59.000Z',
  submission_requirements: [{ type: 'link' }],
}
const survey = {
  title: 'Check-in',
  show_results: true,
  dynamic_responses: false,
  questions: [{
    id: '30200000-0000-4000-8000-000000000001',
    question_type: 'multiple_choice',
    question_text: 'How did it go?',
    options: ['Well', 'Could be better'],
    response_max_chars: 500,
  }],
}

describe('Classwork draft content', () => {
  it('creates an assignment from a body-only edit with an unpublished title and new requirement', () => {
    const { projection } = prepareClassworkContent('assignment', { ...assignment, title: '' }, 'create')
    expect(projection).toMatchObject({
      title: expect.stringMatching(/^Untitled/),
      instructions_markdown: assignment.instructions_markdown,
      submission_requirements: [{ type: 'link' }],
    })
  })

  it('applies only the edited assignment fields, preserving untouched legacy instructions and deadlines', () => {
    const { projection } = prepareClassworkContent('assignment', { ...assignment, fields: ['title'] }, 'apply')
    expect(projection).toEqual({ title: assignment.title })
  })

  it('keeps unfinished survey work in the private snapshot and refuses to apply it', () => {
    const input = { ...survey, editor: { markdownDirty: true, unresolved: true, markdown: 'incomplete' } }
    expect(prepareClassworkContent('survey', input, 'save').draft).toEqual(input)
    expect(() => prepareClassworkContent('survey', input, 'apply')).toThrow('Finish or discard')
  })

  it('rejects duplicated question identities before attempting to publish a survey', () => {
    expect(() => prepareClassworkContent('survey', { ...survey, questions: [...survey.questions, ...survey.questions] }, 'apply'))
      .toThrow('A survey question is duplicated')
  })
})
