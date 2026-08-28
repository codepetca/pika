import { notFound } from 'next/navigation'
import { CourseGuideView } from '@/components/CourseGuideView'
import { getPublishedCourseGuide } from '@/lib/server/course-guide'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function ActualCourseSitePage({ params }: PageProps) {
  const { slug } = await params
  const result = await getPublishedCourseGuide(slug)

  if (!result.ok) {
    notFound()
  }

  return <CourseGuideView guide={result.guide} />
}
