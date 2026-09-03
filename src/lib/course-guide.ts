import type { ActualCourseSiteConfig, TiptapContent } from '@/types'

export type CourseGuideVisibility = Pick<
  ActualCourseSiteConfig,
  'overview' | 'resources' | 'assignments' | 'tests'
>

export type CourseGuideAssignment = {
  key: string
  title: string
}

export type CourseGuideTest = {
  key: string
  title: string
}

export type CourseGuideData = {
  classroom: {
    title: string
  }
  visibility: CourseGuideVisibility
  overviewMarkdown: string
  resourcesContent: TiptapContent | null
  assignments: CourseGuideAssignment[]
  tests: CourseGuideTest[]
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
    || (guide.visibility.assignments && guide.assignments.length > 0)
    || (guide.visibility.tests && guide.tests.length > 0),
  )
}

export function toCourseGuideVisibility(
  config: ActualCourseSiteConfig,
): CourseGuideVisibility {
  return {
    overview: config.overview,
    resources: config.resources,
    assignments: config.assignments,
    tests: config.tests,
  }
}
