import { describe, expect, it } from 'vitest'
import {
  courseBlueprintAssignmentsToMarkdown,
  markdownToCourseBlueprintAssignments,
} from '@/lib/course-blueprint-assignments'

describe('course blueprint assignment markdown', () => {
  it('round-trips structured submission requirements', () => {
    const markdown = courseBlueprintAssignmentsToMarkdown([
      {
        title: 'Build and Deploy',
        instructions_markdown: 'Ship a small app.',
        default_due_days: 7,
        default_due_time: '23:59',
        points_possible: 30,
        include_in_final: true,
        is_draft: true,
        position: 0,
        submission_requirements: [
          {
            type: 'repo_link',
            label: 'Repo link',
            instructions: 'Use your public GitHub repository.',
            required: true,
            position: 0,
          },
          {
            type: 'link',
            label: 'Public link',
            instructions: 'Paste the deployed URL.',
            required: true,
            position: 1,
          },
          {
            type: 'image',
            label: 'Screenshot',
            instructions: 'Upload a screenshot.',
            required: false,
            position: 2,
          },
        ],
      },
    ])

    expect(markdown).toContain('### Submission Requirements')
    expect(markdown).toContain('- repo_link | Repo link | required | Use your public GitHub repository.')
    expect(markdown).toContain('- image | Screenshot | optional | Upload a screenshot.')

    const parsed = markdownToCourseBlueprintAssignments(markdown, [])

    expect(parsed.errors).toEqual([])
    expect(parsed.assignments[0]?.submission_requirements).toEqual([
      expect.objectContaining({
        type: 'repo_link',
        label: 'Repo link',
        instructions: 'Use your public GitHub repository.',
        required: true,
        position: 0,
      }),
      expect.objectContaining({
        type: 'link',
        label: 'Public link',
        instructions: 'Paste the deployed URL.',
        required: true,
        position: 1,
      }),
      expect.objectContaining({
        type: 'image',
        label: 'Screenshot',
        instructions: 'Upload a screenshot.',
        required: false,
        position: 2,
      }),
    ])
  })
})
