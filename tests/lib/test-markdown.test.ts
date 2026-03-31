import { describe, it, expect } from 'vitest'
import { markdownToTest, testToMarkdown, TEST_MARKDOWN_AI_SCHEMA } from '@/lib/test-markdown'

const QUESTION_ID_1 = '11111111-1111-4111-8111-111111111111'
const QUESTION_ID_2 = '22222222-2222-4222-8222-222222222222'
const DOCUMENT_ID_1 = '33333333-3333-4333-8333-333333333333'
const DOCUMENT_ID_2 = '44444444-4444-4444-8444-444444444444'

describe('testToMarkdown', () => {
  it('includes document block guidance in the AI schema template', () => {
    expect(TEST_MARKDOWN_AI_SCHEMA).toContain('### Document 1')
    expect(TEST_MARKDOWN_AI_SCHEMA).toContain('Source: link')
    expect(TEST_MARKDOWN_AI_SCHEMA).toContain('Source: text')
    expect(TEST_MARKDOWN_AI_SCHEMA).toContain('Source: upload')
    expect(TEST_MARKDOWN_AI_SCHEMA).toContain('URL: https://example.com/doc')
    expect(TEST_MARKDOWN_AI_SCHEMA).toContain('URL: https://example.com/file.pdf')
    expect(TEST_MARKDOWN_AI_SCHEMA).toContain('<Paste reference text here>')
    expect(TEST_MARKDOWN_AI_SCHEMA).toContain('# _None_')
  })

  it('serializes title, questions, and documents', () => {
    const markdown = testToMarkdown({
      title: 'Unit Test 1',
      show_results: false,
      questions: [
        {
          id: QUESTION_ID_1,
          question_type: 'multiple_choice',
          question_text: 'What is 2 + 2?',
          options: ['3', '4', '5'],
          correct_option: 1,
          points: 2,
        },
        {
          id: QUESTION_ID_2,
          question_type: 'open_response',
          question_text: 'Explain polymorphism.',
          options: [],
          correct_option: null,
          answer_key: 'Any correct explanation is acceptable.',
          points: 5,
          response_max_chars: 3000,
          response_monospace: true,
        },
      ],
      documents: [
        {
          id: DOCUMENT_ID_1,
          title: 'Java API',
          source: 'link',
          url: 'https://docs.oracle.com',
        },
        {
          id: DOCUMENT_ID_2,
          title: 'Allowed formulas',
          source: 'text',
          content: 'distance = rate * time',
        },
      ],
    })

    expect(markdown).toContain('Title: Unit Test 1')
    expect(markdown).toContain('Show Results: false')
    expect(markdown).toContain(`ID: ${QUESTION_ID_1}`)
    expect(markdown).toContain('Type: multiple_choice')
    expect(markdown).toContain('Correct Option: 2')
    expect(markdown).toContain(`ID: ${QUESTION_ID_2}`)
    expect(markdown).toContain('Type: open_response')
    expect(markdown).toContain('Code: true')
    expect(markdown).toContain('Max Chars: 3000')
    expect(markdown).toContain('## Documents')
    expect(markdown).toContain('Source: link')
    expect(markdown).toContain('Source: text')
  })
})

describe('markdownToTest', () => {
  it('parses valid markdown into strict draft content and documents', () => {
    const markdown = `# Test
Title: Unit Test 1
Show Results: true

## Questions
### Question 1
ID: ${QUESTION_ID_1}
Type: multiple_choice
Points: 2
Prompt:
What is 2 + 2?
Options:
- 3
- 4
- 5
Correct Option: 2

### Question 2
ID: ${QUESTION_ID_2}
Type: open_response
Points: 5
Code: true
Max Chars: 3000
Prompt:
Explain polymorphism.
Answer Key:
Any correct explanation is acceptable.

## Documents
### Document 1
ID: ${DOCUMENT_ID_1}
Source: link
Title: Java API
URL: https://docs.oracle.com

### Document 2
ID: ${DOCUMENT_ID_2}
Source: text
Title: Allowed formulas
Content:
distance = rate * time
`

    const result = markdownToTest(markdown)
    expect(result.errors).toEqual([])
    expect(result.draftContent).not.toBeNull()
    expect(result.draftContent?.title).toBe('Unit Test 1')
    expect(result.draftContent?.show_results).toBe(true)
    expect(result.draftContent?.questions).toHaveLength(2)
    expect(result.draftContent?.questions[0]).toMatchObject({
      id: QUESTION_ID_1,
      question_type: 'multiple_choice',
      correct_option: 1,
      points: 2,
    })
    expect(result.draftContent?.questions[1]).toMatchObject({
      id: QUESTION_ID_2,
      question_type: 'open_response',
      response_monospace: true,
      response_max_chars: 3000,
      points: 5,
    })
    expect(result.documents).toEqual([
      {
        id: DOCUMENT_ID_1,
        source: 'link',
        title: 'Java API',
        url: 'https://docs.oracle.com',
      },
      {
        id: DOCUMENT_ID_2,
        source: 'text',
        title: 'Allowed formulas',
        content: 'distance = rate * time',
      },
    ])
  })

  it('uses defaults for optional fields and existing ids when id lines are omitted', () => {
    const markdown = `# Test
Title: Draft

## Questions
### Question 1
Prompt:
Pick one.
Options:
- A
- B
Correct Option: 1

### Question 2
Type: open_response
Prompt:
Explain your answer.

## Documents
_None_
`

    const result = markdownToTest(markdown, {
      defaultShowResults: true,
      existingQuestions: [
        { id: QUESTION_ID_1 },
        { id: QUESTION_ID_2 },
      ],
    })

    expect(result.errors).toEqual([])
    expect(result.draftContent).not.toBeNull()
    expect(result.draftContent?.show_results).toBe(true)
    expect(result.draftContent?.questions[0]).toMatchObject({
      id: QUESTION_ID_1,
      question_type: 'multiple_choice',
      points: 1,
      correct_option: 0,
    })
    expect(result.draftContent?.questions[1]).toMatchObject({
      id: QUESTION_ID_2,
      question_type: 'open_response',
      points: 5,
      response_monospace: false,
      response_max_chars: 5000,
    })
    expect(result.documents).toEqual([])
  })

  it('returns an error when multiple-choice Correct Option is missing', () => {
    const markdown = `# Test
Title: Draft

## Questions
### Question 1
Type: multiple_choice
Prompt:
Pick one.
Options:
- A
- B
`

    const result = markdownToTest(markdown)

    expect(result.draftContent).toBeNull()
    expect(result.errors).toContain(
      'Question 1: Correct Option is required for multiple_choice questions'
    )
  })

  it('preserves existing documents when markdown omits the Documents section', () => {
    const markdown = `# Test
Title: Draft

## Questions
### Question 1
ID: ${QUESTION_ID_1}
Type: multiple_choice
Prompt:
Pick one.
Options:
- A
- B
Correct Option: 1
`

    const result = markdownToTest(markdown, {
      existingDocuments: [
        {
          id: DOCUMENT_ID_1,
          title: 'Java API',
          source: 'link',
          url: 'https://docs.oracle.com',
        },
      ],
    })

    expect(result.errors).toEqual([])
    expect(result.documents).toEqual([
      {
        id: DOCUMENT_ID_1,
        title: 'Java API',
        source: 'link',
        url: 'https://docs.oracle.com',
      },
    ])
  })

  it('returns strict errors and blocks parsing when required structure is invalid', () => {
    const markdown = `# Test
Show Results: maybe

## Questions
### Question 1
Type: multiple_choice
Prompt:

Options:
- Only one option
Correct Option: 3

## Documents
### Document 1
Source: link
Title: Bad Doc
URL: not-a-valid-url
`

    const result = markdownToTest(markdown)
    expect(result.draftContent).toBeNull()
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors.join('\n')).toContain('Title is required')
    expect(result.errors.join('\n')).toContain('Show Results must be true or false')
    expect(result.errors.join('\n')).toContain('Question 1: Prompt is required')
    expect(result.errors.join('\n')).toContain('Each document must include valid id/title')
  })
})
