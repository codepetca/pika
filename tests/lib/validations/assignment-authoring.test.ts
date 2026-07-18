import { describe, expect, it } from 'vitest'
import { teacherAssignmentPatchSchema } from '@/lib/validations/assignment-authoring'

describe('teacherAssignmentPatchSchema', () => {
  it('accepts a strict assignment and requirement update', () => {
    const input = {
      title: 'Updated assignment',
      due_at: '2026-08-01T03:59:59.000Z',
      submission_requirements: [{
        id: '10000000-0000-4000-8000-000000000001',
        type: 'link',
        label: 'Published work',
        required: true,
        position: 0,
        validation_policy_json: {
          mode: 'expected_domain',
          expected_domains: ['example.com'],
        },
      }],
    }

    expect(teacherAssignmentPatchSchema.parse(input)).toEqual(input)
  })

  it('rejects unknown requirement types instead of normalizing them away', () => {
    expect(teacherAssignmentPatchSchema.safeParse({
      submission_requirements: [{ type: 'repo', label: 'Repository' }],
    }).success).toBe(false)
  })

  it('rejects malformed requirement identifiers', () => {
    expect(teacherAssignmentPatchSchema.safeParse({
      submission_requirements: [{ id: 'requirement-1', type: 'link' }],
    }).success).toBe(false)
  })

  it('rejects unknown assignment fields', () => {
    expect(teacherAssignmentPatchSchema.safeParse({ unexpected: true }).success).toBe(false)
  })
})
