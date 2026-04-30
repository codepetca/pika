import { describe, expect, it } from 'vitest'
import { updateClassroomPublishingSchema, updateCourseBlueprintSchema } from '@/lib/validations/teacher'

describe('teacher validations', () => {
  it('rejects publishing a planned site when the request clears the slug', () => {
    const result = updateCourseBlueprintSchema.safeParse({
      planned_site_slug: null,
      planned_site_published: true,
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('A planned site slug is required before publishing the planned site')
  })

  it('rejects publishing an actual site when the request clears the slug', () => {
    const result = updateClassroomPublishingSchema.safeParse({
      actualSiteSlug: null,
      actualSitePublished: true,
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('A public slug is required before publishing the actual course website')
  })
})
