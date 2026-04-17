import { describe, expect, it } from 'vitest'
import { markdownToQuiz, quizToMarkdown } from '@/lib/quiz-markdown'

describe('quizToMarkdown', () => {
  it('serializes a quiz draft into markdown', () => {
    const markdown = quizToMarkdown({
      title: 'Intro Quiz',
      show_results: false,
      questions: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          question_text: 'What is the first step?',
          options: ['Plan', 'Ignore', 'Delete'],
        },
      ],
    })

    expect(markdown).toContain('Title: Intro Quiz')
    expect(markdown).toContain('Show Results: false')
    expect(markdown).toContain('Prompt:')
    expect(markdown).toContain('- Plan')
  })
})

describe('markdownToQuiz', () => {
  it('parses quiz markdown into draft content', () => {
    const markdown = `# Quiz
Title: Intro Quiz
Show Results: true

## Questions
### Question 1
Prompt:
What is the first step?
Options:
- Plan
- Practice
- Submit`

    const result = markdownToQuiz(markdown)

    expect(result.errors).toEqual([])
    expect(result.draftContent).toEqual({
      title: 'Intro Quiz',
      show_results: true,
      questions: [
        {
          id: expect.any(String),
          question_text: 'What is the first step?',
          options: ['Plan', 'Practice', 'Submit'],
        },
      ],
    })
  })

  it('returns actionable errors for invalid markdown', () => {
    const markdown = `# Quiz
Title: 

## Questions
### Question 1
Prompt:
Options:
- Only one`

    const result = markdownToQuiz(markdown)

    expect(result.draftContent).toBeNull()
    expect(result.errors).toContain('Question 1: Prompt is required')
    expect(result.errors).toContain('Question 1: At least 2 options are required')
    expect(result.errors).toContain('Title is required')
  })
})
