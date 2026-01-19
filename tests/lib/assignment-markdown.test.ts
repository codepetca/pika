/**
 * Unit tests for assignment-markdown.ts
 */

import { describe, it, expect } from 'vitest'
import {
  assignmentsToMarkdown,
  markdownToAssignments,
  hasRichFormatting,
} from '@/lib/assignment-markdown'
import type { Assignment, TiptapContent } from '@/types'

function makeAssignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: 'a-1',
    classroom_id: 'c-1',
    title: 'Test Assignment',
    description: 'Plain text description',
    rich_instructions: null,
    due_at: '2025-01-20T23:59:00Z',
    position: 0,
    is_draft: false,
    released_at: '2025-01-01T00:00:00Z',
    created_by: 't-1',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('assignmentsToMarkdown', () => {
  it('should generate empty markdown for no assignments', () => {
    const result = assignmentsToMarkdown([])
    expect(result.markdown).toBe('')
    expect(result.hasRichContent).toBe(false)
  })

  it('should include assignment title as h2', () => {
    const assignments = [makeAssignment({ title: 'Homework 1' })]
    const result = assignmentsToMarkdown(assignments)
    expect(result.markdown).toContain('## Homework 1')
  })

  it('should include [DRAFT] marker for draft assignments', () => {
    const assignments = [makeAssignment({ title: 'Homework 1', is_draft: true, released_at: null })]
    const result = assignmentsToMarkdown(assignments)
    expect(result.markdown).toContain('## Homework 1 [DRAFT]')
  })

  it('should format due date in Toronto timezone', () => {
    const assignments = [makeAssignment({ due_at: '2025-01-20T23:59:00Z' })]
    const result = assignmentsToMarkdown(assignments)
    // Jan 20, 2025 at 23:59 UTC = Jan 20, 2025 at 6:59 PM EST
    expect(result.markdown).toMatch(/Due: Mon, Jan 20, 2025 at \d{1,2}:\d{2} [AP]M/)
  })

  it('should not include assignment ID', () => {
    const assignments = [makeAssignment({ id: 'abc123-def456' })]
    const result = assignmentsToMarkdown(assignments)
    expect(result.markdown).not.toContain('ID:')
  })

  it('should include plain text instructions', () => {
    const assignments = [makeAssignment({ description: 'Complete problems 1-10' })]
    const result = assignmentsToMarkdown(assignments)
    expect(result.markdown).toContain('Complete problems 1-10')
  })

  it('should extract text from rich instructions', () => {
    const richInstructions: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'First paragraph.' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Second paragraph.' }],
        },
      ],
    }
    const assignments = [makeAssignment({ rich_instructions: richInstructions })]
    const result = assignmentsToMarkdown(assignments)
    expect(result.markdown).toContain('First paragraph.')
    expect(result.markdown).toContain('Second paragraph.')
  })

  it('should indicate hasRichContent when rich formatting is present', () => {
    const richInstructions: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Bold text', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    }
    const assignments = [makeAssignment({ rich_instructions: richInstructions })]
    const result = assignmentsToMarkdown(assignments)
    expect(result.hasRichContent).toBe(true)
  })

  it('should separate assignments with ---', () => {
    const assignments = [
      makeAssignment({ id: 'a-1', title: 'Assignment 1', position: 0 }),
      makeAssignment({ id: 'a-2', title: 'Assignment 2', position: 1 }),
    ]
    const result = assignmentsToMarkdown(assignments)
    expect(result.markdown).toContain('---')
  })

  it('should maintain order based on input array', () => {
    const assignments = [
      makeAssignment({ id: 'a-1', title: 'First', position: 0 }),
      makeAssignment({ id: 'a-2', title: 'Second', position: 1 }),
      makeAssignment({ id: 'a-3', title: 'Third', position: 2 }),
    ]
    const result = assignmentsToMarkdown(assignments)
    const firstIndex = result.markdown.indexOf('First')
    const secondIndex = result.markdown.indexOf('Second')
    const thirdIndex = result.markdown.indexOf('Third')
    expect(firstIndex).toBeLessThan(secondIndex)
    expect(secondIndex).toBeLessThan(thirdIndex)
  })
})

describe('markdownToAssignments', () => {
  const existingAssignments = [
    makeAssignment({ id: 'a-1', title: 'Existing Assignment' }),
  ]

  it('should match assignment by title', () => {
    const markdown = `## Existing Assignment
Due: Mon, Jan 20, 2025 at 6:59 PM

Updated instructions here.

---
`
    const result = markdownToAssignments(markdown, existingAssignments)
    expect(result.errors).toHaveLength(0)
    expect(result.assignments).toHaveLength(1)
    expect(result.assignments[0].id).toBe('a-1')
    expect(result.assignments[0].title).toBe('Existing Assignment')
  })

  it('should match assignment by title case-insensitively', () => {
    const markdown = `## EXISTING ASSIGNMENT
Due: Mon, Jan 20, 2025 at 6:59 PM

Updated instructions here.

---
`
    const result = markdownToAssignments(markdown, existingAssignments)
    expect(result.errors).toHaveLength(0)
    expect(result.assignments).toHaveLength(1)
    expect(result.assignments[0].id).toBe('a-1')
  })

  it('should parse new assignment without matching title', () => {
    const markdown = `## New Assignment
Due: Tue, Jan 21, 2025 at 11:59 PM

Instructions for new assignment.

---
`
    const result = markdownToAssignments(markdown, [])
    expect(result.errors).toHaveLength(0)
    expect(result.assignments).toHaveLength(1)
    expect(result.assignments[0].id).toBeUndefined()
    expect(result.assignments[0].title).toBe('New Assignment')
    expect(result.assignments[0].is_draft).toBe(true) // New assignments are drafts
  })

  it('should return error for duplicate titles', () => {
    const markdown = `## Assignment One
Due: Mon, Jan 20, 2025 at 6:59 PM

Instructions.

---

## Assignment One
Due: Tue, Jan 21, 2025 at 11:59 PM

More instructions.

---
`
    const result = markdownToAssignments(markdown, [])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('Duplicate assignment title')
  })

  it('should parse [DRAFT] marker as draft status', () => {
    const markdown = `## Draft Assignment [DRAFT]
Due: Mon, Jan 20, 2025 at 6:59 PM

Instructions.

---
`
    const draftAssignment = makeAssignment({ id: 'a-1', title: 'Draft Assignment', is_draft: true, released_at: null })
    const result = markdownToAssignments(markdown, [draftAssignment])
    expect(result.errors).toHaveLength(0)
    expect(result.assignments[0].is_draft).toBe(true)
    expect(result.assignments[0].title).toBe('Draft Assignment')
  })

  it('should allow removing [DRAFT] to release assignment', () => {
    const markdown = `## Released Assignment
Due: Mon, Jan 20, 2025 at 6:59 PM

Instructions.

---
`
    const draftAssignment = makeAssignment({ id: 'a-1', title: 'Released Assignment', is_draft: true, released_at: null })
    const result = markdownToAssignments(markdown, [draftAssignment])
    expect(result.errors).toHaveLength(0)
    expect(result.assignments[0].is_draft).toBe(false)
  })

  it('should return error when trying to un-release assignment', () => {
    const markdown = `## Assignment [DRAFT]
Due: Mon, Jan 20, 2025 at 6:59 PM

Instructions.

---
`
    const releasedAssignment = makeAssignment({
      id: 'a-1',
      title: 'Assignment',
      is_draft: false,
      released_at: '2025-01-01T00:00:00Z',
    })
    const result = markdownToAssignments(markdown, [releasedAssignment])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('Cannot un-release assignment')
  })

  it('should parse due date correctly', () => {
    const markdown = `# Assignments: Biology 101

## Assignment
Due: Tue, Jan 21, 2025 at 11:59 PM

Instructions.

---
`
    const result = markdownToAssignments(markdown, [])
    expect(result.errors).toHaveLength(0)
    expect(result.assignments[0].due_at).toBeDefined()
    // The date should be parsed to a valid ISO string
    const dueDate = new Date(result.assignments[0].due_at!)
    expect(dueDate.getFullYear()).toBe(2025)
    expect(dueDate.getMonth()).toBe(0) // January
    expect(dueDate.getDate()).toBe(21)
  })

  it('should return error for missing title', () => {
    const markdown = `# Assignments: Biology 101

##
Due: Mon, Jan 20, 2025 at 6:59 PM

Instructions.

---
`
    const result = markdownToAssignments(markdown, [])
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toContain('has no title')
  })

  it('should return error for invalid due date', () => {
    const markdown = `# Assignments: Biology 101

## Assignment
Due: Invalid Date Format

Instructions.

---
`
    const result = markdownToAssignments(markdown, [])
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toContain('Invalid due date')
  })

  it('should parse multi-line instructions', () => {
    const markdown = `## Assignment
Due: Mon, Jan 20, 2025 at 6:59 PM

First paragraph of instructions.

Second paragraph of instructions.

Third paragraph.

---
`
    const result = markdownToAssignments(markdown, [makeAssignment({ id: 'a-1', title: 'Assignment' })])
    expect(result.errors).toHaveLength(0)
    expect(result.assignments[0].instructions).toContain('First paragraph')
    expect(result.assignments[0].instructions).toContain('Second paragraph')
    expect(result.assignments[0].instructions).toContain('Third paragraph')
  })

  it('should maintain position based on order in markdown', () => {
    const markdown = `## First Assignment
Due: Mon, Jan 20, 2025 at 6:59 PM

Instructions.

---

## Second Assignment
Due: Tue, Jan 21, 2025 at 6:59 PM

Instructions.

---

## Third Assignment
Due: Wed, Jan 22, 2025 at 6:59 PM

Instructions.

---
`
    const result = markdownToAssignments(markdown, [])
    expect(result.assignments).toHaveLength(3)
    expect(result.assignments[0].position).toBe(0)
    expect(result.assignments[1].position).toBe(1)
    expect(result.assignments[2].position).toBe(2)
  })

  it('should handle assignment without instructions', () => {
    const markdown = `## Existing Assignment
Due: Mon, Jan 20, 2025 at 6:59 PM

---
`
    const result = markdownToAssignments(markdown, existingAssignments)
    expect(result.errors).toHaveLength(0)
    expect(result.assignments[0].instructions).toBe('')
  })

  it('should warn when existing assignment is not in markdown', () => {
    const markdown = `## Different Assignment
Due: Mon, Jan 20, 2025 at 6:59 PM

Instructions.

---
`
    const result = markdownToAssignments(markdown, existingAssignments)
    // This should still succeed (add-only means we don't delete)
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toContain('Assignment "Existing Assignment" not in markdown - will be preserved')
  })

  it('should parse multiple assignments correctly', () => {
    const existing = [
      makeAssignment({ id: 'a-1', title: 'First' }),
      makeAssignment({ id: 'a-2', title: 'Second' }),
    ]
    const markdown = `## First
Due: Mon, Jan 20, 2025 at 6:59 PM

Instructions 1.

---

## Second
Due: Tue, Jan 21, 2025 at 6:59 PM

Instructions 2.

---
`
    const result = markdownToAssignments(markdown, existing)
    expect(result.errors).toHaveLength(0)
    expect(result.assignments).toHaveLength(2)
    expect(result.assignments[0].id).toBe('a-1')
    expect(result.assignments[1].id).toBe('a-2')
    expect(result.assignments[0].title).toBe('First')
    expect(result.assignments[1].title).toBe('Second')
  })
})

describe('hasRichFormatting', () => {
  it('should return false for plain text', () => {
    const content: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Plain text' }],
        },
      ],
    }
    expect(hasRichFormatting(content)).toBe(false)
  })

  it('should return true for bold text', () => {
    const content: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Bold', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    }
    expect(hasRichFormatting(content)).toBe(true)
  })

  it('should return true for italic text', () => {
    const content: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Italic', marks: [{ type: 'italic' }] },
          ],
        },
      ],
    }
    expect(hasRichFormatting(content)).toBe(true)
  })

  it('should return true for links', () => {
    const content: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Link',
              marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
            },
          ],
        },
      ],
    }
    expect(hasRichFormatting(content)).toBe(true)
  })

  it('should return true for bullet lists', () => {
    const content: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Item' }],
                },
              ],
            },
          ],
        },
      ],
    }
    expect(hasRichFormatting(content)).toBe(true)
  })

  it('should return true for ordered lists', () => {
    const content: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'orderedList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Item' }],
                },
              ],
            },
          ],
        },
      ],
    }
    expect(hasRichFormatting(content)).toBe(true)
  })

  it('should return true for headings', () => {
    const content: TiptapContent = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Heading' }],
        },
      ],
    }
    expect(hasRichFormatting(content)).toBe(true)
  })

  it('should return false for empty content', () => {
    const content: TiptapContent = {
      type: 'doc',
      content: [],
    }
    expect(hasRichFormatting(content)).toBe(false)
  })

  it('should return false for null content', () => {
    expect(hasRichFormatting(null)).toBe(false)
  })
})
