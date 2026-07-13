import { describe, expect, it } from 'vitest'
import {
  createClassroomSchema,
  updateClassroomPublishingSchema,
} from '@/lib/validations/teacher'

describe('teacher validations', () => {
  it('rejects publishing a syllabus when the request clears the slug', () => {
    const result = updateClassroomPublishingSchema.safeParse({
      actualSiteSlug: null,
      actualSitePublished: true,
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('A syllabus slug is required before publishing the syllabus')
  })

  it('accepts supported classroom theme colors', () => {
    expect(createClassroomSchema.safeParse({ title: 'Math', themeColor: 'teal' }).success).toBe(true)
    expect(updateClassroomPublishingSchema.safeParse({ themeColor: 'cyan' }).success).toBe(true)
  })

  it('rejects unsupported classroom theme colors', () => {
    expect(createClassroomSchema.safeParse({ title: 'Math', themeColor: 'magenta' }).success).toBe(false)
    expect(updateClassroomPublishingSchema.safeParse({ themeColor: 'magenta' }).success).toBe(false)
  })
})
