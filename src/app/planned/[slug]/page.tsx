import { notFound } from 'next/navigation'
import { PlannedCourseDocument } from '../PlannedCourseDocument'
import { getPublishedPlannedCourseSite } from '@/lib/server/course-sites'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function PlannedCourseSitePage({ params }: PageProps) {
  const { slug } = await params
  const result = await getPublishedPlannedCourseSite(slug)

  if (!result.ok) {
    notFound()
  }

  return <PlannedCourseDocument blueprint={result.site.blueprint} />
}
