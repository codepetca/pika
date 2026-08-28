import { NextResponse } from 'next/server'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { courseSiteSlugSchema } from '@/lib/validations/course-publishing'
import { getPublishedCourseGuide } from '@/lib/server/course-guide'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetPublicCourseGuide', async (_request, context) => {
  const params = await context.params
  const slug = courseSiteSlugSchema.parse(params.slug)
  const result = await getPublishedCourseGuide(slug)

  if (!result.ok) {
    throw new ApiError(result.status, result.error)
  }

  return NextResponse.json({ guide: result.guide })
})
