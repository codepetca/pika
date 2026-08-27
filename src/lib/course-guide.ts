import { formatInTimeZone } from 'date-fns-tz'
import type { ActualCourseSiteConfig, TiptapContent } from '@/types'

export type CourseGuideDocumentLink = {
  key: string
  title: string
  href: string
}

export type CourseGuideAssignment = {
  key: string
  title: string
  instructionsMarkdown: string
  dueAt: string | null
  pointsPossible: number | null
  includeInFinal: boolean
  courseWeightPercent: number | null
  position: number
}

export type CourseGuideTest = {
  key: string
  title: string
  pointsPossible: number | null
  includeInFinal: boolean
  courseWeightPercent: number | null
  position: number
  documents: CourseGuideDocumentLink[]
}

export type CourseGuideLessonPlan = {
  key: string
  date: string
  contentMarkdown: string
}

export type CourseGuideAnnouncement = {
  key: string
  title: string | null
  content: string
  publishedAt: string
}

export type CourseGuideData = {
  classroom: {
    title: string
    classCode: string
    termLabel: string | null
    startDate: string | null
    endDate: string | null
  }
  visibility: ActualCourseSiteConfig
  overviewMarkdown: string
  outlineMarkdown: string
  resourcesContent: TiptapContent | null
  assignments: CourseGuideAssignment[]
  tests: CourseGuideTest[]
  lessonPlans: CourseGuideLessonPlan[]
  announcements: CourseGuideAnnouncement[]
}

export type CourseGuidePublicSharingReadiness = {
  ready: boolean
  missing: string[]
}

export function getCourseGuidePublicSharingReadiness(args: {
  enabled: boolean
  slug: string | null | undefined
}): CourseGuidePublicSharingReadiness {
  const missing: string[] = []

  if (args.enabled && !args.slug?.trim()) missing.push('Public page address')

  return { ready: missing.length === 0, missing }
}

export function hasCourseGuideContent(guide: CourseGuideData): boolean {
  return Boolean(
    (guide.visibility.overview && guide.overviewMarkdown.trim())
    || (guide.visibility.resources && guide.resourcesContent)
    || (guide.visibility.assignments && guide.assignments.length > 0)
    || (guide.visibility.tests && guide.tests.length > 0)
    || (guide.visibility.lesson_plans && guide.lessonPlans.length > 0)
    || (guide.visibility.announcements && guide.announcements.length > 0),
  )
}

export function formatCourseGuideDueDate(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return formatInTimeZone(parsed, 'America/Toronto', 'EEE MMM d')
}
