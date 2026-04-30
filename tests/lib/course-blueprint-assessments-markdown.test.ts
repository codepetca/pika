import { describe, expect, it } from 'vitest'
import { courseBlueprintAssessmentsToMarkdown } from '@/lib/course-blueprint-assessments-markdown'

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
          position: 0,
        },
      ] as any,
      'quiz'
    )

    expect(markdown).toContain('Title: Check-in quiz')
    expect(markdown).toContain('## Questions')
  })
})
