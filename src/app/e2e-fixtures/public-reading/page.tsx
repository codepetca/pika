import { notFound } from 'next/navigation'
import { PlannedCourseDocument } from '@/app/planned/PlannedCourseDocument'
import { CourseGuideView } from '@/components/CourseGuideView'
import { actualFixture, plannedFixture, publicReadingVariants } from './data'

export const dynamic = 'force-dynamic'

/** Fixed anonymous production reading owners; no loaders, sessions or data writes. */
export default async function PublicReadingFixture({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  if (process.env.NODE_ENV === 'production' || process.env.PIKA_E2E_FIXTURES !== 'true') notFound()
  const query = await searchParams
  const variant = query.variant || 'planned-long'
  if (!publicReadingVariants.some((candidate) => candidate === variant)) notFound()
  return variant.startsWith('planned-')
    ? <PlannedCourseDocument blueprint={plannedFixture(variant)} />
    : <CourseGuideView guide={actualFixture(variant)} />
}
