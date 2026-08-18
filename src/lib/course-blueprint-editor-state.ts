import { courseBlueprintAssignmentsToMarkdown } from '@/lib/course-blueprint-assignments'
import { courseBlueprintAssessmentsToMarkdown } from '@/lib/course-blueprint-assessments-markdown'
import { courseBlueprintLessonTemplatesToMarkdown } from '@/lib/course-blueprint-lesson-templates'
import { courseBlueprintMaterialsToMarkdown } from '@/lib/course-blueprint-materials'
import { courseBlueprintSurveysToMarkdown } from '@/lib/course-blueprint-surveys'
import { DEFAULT_PLANNED_COURSE_SITE_CONFIG } from '@/lib/course-site-publishing'
import type { CourseBlueprintDetail, PlannedCourseSiteConfig } from '@/types'

export const COURSE_BLUEPRINT_MARKDOWN_TABS = [
  'overview',
  'outline',
  'resources',
  'assignments',
  'tests',
  'lesson-plans',
  'materials',
  'surveys',
] as const

export type CourseBlueprintMarkdownTab = typeof COURSE_BLUEPRINT_MARKDOWN_TABS[number]
export type CourseBlueprintEditorSection =
  | 'metadata'
  | 'planned-site'
  | 'grading'
  | CourseBlueprintMarkdownTab

export type CourseBlueprintMetadataDraft = {
  title: string
  subject: string
  grade_level: string
  course_code: string
  term_template: string
}

export type CourseBlueprintPlannedSiteDraft = {
  slug: string
  published: boolean
  config: PlannedCourseSiteConfig
}

export type CourseBlueprintGradingDraft = {
  use_weights: boolean
  assignments_weight: number
  tests_weight: number
}

export type CourseBlueprintDraftState = Record<CourseBlueprintMarkdownTab, string>

export type CourseBlueprintEditorState = {
  metadata: CourseBlueprintMetadataDraft
  plannedSite: CourseBlueprintPlannedSiteDraft
  grading: CourseBlueprintGradingDraft
  drafts: CourseBlueprintDraftState
}

export function normalizePlannedCourseSiteConfig(
  config: PlannedCourseSiteConfig | null | undefined,
): PlannedCourseSiteConfig {
  return {
    ...DEFAULT_PLANNED_COURSE_SITE_CONFIG,
    ...(config || {}),
  }
}

export function emptyCourseBlueprintDraftState(): CourseBlueprintDraftState {
  return {
    overview: '',
    outline: '',
    resources: '',
    assignments: '',
    tests: '',
    'lesson-plans': '',
    materials: '',
    surveys: '',
  }
}

export function courseBlueprintEditorStateFromDetail(
  detail: CourseBlueprintDetail,
): CourseBlueprintEditorState {
  return {
    metadata: {
      title: detail.title,
      subject: detail.subject,
      grade_level: detail.grade_level,
      course_code: detail.course_code,
      term_template: detail.term_template,
    },
    plannedSite: {
      slug: detail.planned_site_slug || '',
      published: detail.planned_site_published,
      config: normalizePlannedCourseSiteConfig(detail.planned_site_config),
    },
    grading: {
      use_weights: detail.gradebook_use_weights ?? false,
      assignments_weight: detail.gradebook_assignments_weight ?? 70,
      tests_weight: detail.gradebook_tests_weight ?? 30,
    },
    drafts: {
      overview: detail.overview_markdown || '',
      outline: detail.outline_markdown || '',
      resources: detail.resources_markdown || '',
      assignments: courseBlueprintAssignmentsToMarkdown(detail.assignments),
      tests: courseBlueprintAssessmentsToMarkdown(detail.assessments as any, 'test'),
      'lesson-plans': courseBlueprintLessonTemplatesToMarkdown(detail.lesson_templates),
      materials: courseBlueprintMaterialsToMarkdown(detail.materials || []),
      surveys: courseBlueprintSurveysToMarkdown(detail.surveys || []),
    },
  }
}

function recordsEqual(
  left: object,
  right: object,
) {
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])
  return [...keys].every((key) => leftRecord[key] === rightRecord[key])
}

export function getCourseBlueprintDirtySections(
  current: CourseBlueprintEditorState,
  saved: CourseBlueprintEditorState,
): CourseBlueprintEditorSection[] {
  const dirtySections: CourseBlueprintEditorSection[] = []

  if (!recordsEqual(current.metadata, saved.metadata)) dirtySections.push('metadata')
  if (
    current.plannedSite.slug !== saved.plannedSite.slug
    || current.plannedSite.published !== saved.plannedSite.published
    || !recordsEqual(current.plannedSite.config, saved.plannedSite.config)
  ) {
    dirtySections.push('planned-site')
  }
  if (!recordsEqual(current.grading, saved.grading)) dirtySections.push('grading')

  COURSE_BLUEPRINT_MARKDOWN_TABS.forEach((tab) => {
    if (current.drafts[tab] !== saved.drafts[tab]) dirtySections.push(tab)
  })

  return dirtySections
}
