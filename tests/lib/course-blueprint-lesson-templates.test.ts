import { describe, expect, it } from 'vitest'
import {
  courseBlueprintLessonTemplatesToMarkdown,
  markdownToCourseBlueprintLessonTemplates,
} from '@/lib/course-blueprint-lesson-templates'

describe('course blueprint lesson template markdown', () => {
  it('round-trips stable artifact ids', () => {
    const markdown = courseBlueprintLessonTemplatesToMarkdown([{
      artifact_id: '11111111-1111-4111-8111-111111111111',
      title: 'Course launch',
      content_markdown: 'Review expectations.',
      position: 0,
    }])

    expect(markdown).toContain('Artifact ID: 11111111-1111-4111-8111-111111111111')

    const parsed = markdownToCourseBlueprintLessonTemplates(markdown, [])

    expect(parsed.errors).toEqual([])
    expect(parsed.lesson_templates[0]?.artifact_id).toBe(
      '11111111-1111-4111-8111-111111111111'
    )
  })

  it('rejects missing artifact ids in the identity-aware format', () => {
    const parsed = markdownToCourseBlueprintLessonTemplates(
      '## Course launch\n\nReview expectations.',
      [],
      { requireArtifactIds: true }
    )

    expect(parsed.errors).toContain('Lesson "Course launch" is missing Artifact ID')
  })
})
