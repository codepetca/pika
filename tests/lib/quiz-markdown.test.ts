import { describe, expect, it } from 'vitest'
import {
  assessmentToMarkdown,
  markdownToAssessment,
  markdownToQuiz,
  quizToMarkdown,
} from '@/lib/quiz-markdown'

describe('legacy quiz markdown compatibility', () => {
  it('serializes assessment draft content into legacy quiz markdown', () => {
    const markdown = assessmentToMarkdown({
      title: 'Legacy Check-in',
      show_results: false,
      questions: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          question_text: 'What is the first step?',
          options: ['Plan', 'Ignore', 'Delete'],
        },
      ],
    })

    expect(markdown).toContain('Title: Legacy Check-in')
    expect(markdown).toContain('Show Results: false')
    expect(markdown).toContain('Prompt:')
    expect(markdown).toContain('- Plan')
  })

  it('parses legacy quiz markdown into assessment draft content', () => {
    const markdown = `# Quiz
Title: Legacy Check-in
Show Results: true

## Questions
### Question 1
Prompt:
What is the first step?
Options:
- Plan
- Practice
- Submit`

    const result = markdownToAssessment(markdown)

    expect(result.errors).toEqual([])
    expect(result.draftContent).toMatchObject({
      title: 'Legacy Check-in',
      show_results: true,
      questions: [
        {
          id: expect.any(String),
          question_text: 'What is the first step?',
          options: ['Plan', 'Practice', 'Submit'],
        },
      ],
    })
    expect(result.draftContent?.source_format).toBe('markdown')
    expect(result.draftContent?.source_markdown).toContain('Title: Legacy Check-in')
  })

  it('returns actionable errors for invalid legacy quiz markdown', () => {
    const markdown = `# Quiz
Title: 

## Questions
### Question 1
Prompt:
Options:
- Only one`

    const result = markdownToAssessment(markdown)

    expect(result.draftContent).toBeNull()
    expect(result.errors).toContain('Question 1: Prompt is required')
    expect(result.errors).toContain('Question 1: At least 2 options required')
    expect(result.errors).toContain('Title is required')
  })

  it('keeps legacy quiz markdown exports as compatibility aliases', () => {
    expect(quizToMarkdown).toBe(assessmentToMarkdown)
    expect(markdownToQuiz).toBe(markdownToAssessment)
  })
})
