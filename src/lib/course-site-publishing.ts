import type {
  ActualCourseSiteConfig,
  PlannedCourseSiteConfig,
  PublishedCourseSiteLessonPlanScope,
} from '@/types'

export const DEFAULT_PLANNED_COURSE_SITE_CONFIG: PlannedCourseSiteConfig = {
  overview: true,
  outline: true,
  resources: true,
  assignments: true,
  quizzes: false,
  tests: true,
  lesson_plans: true,
}

export const DEFAULT_ACTUAL_COURSE_SITE_CONFIG: ActualCourseSiteConfig = {
  ...DEFAULT_PLANNED_COURSE_SITE_CONFIG,
  announcements: true,
  lesson_plan_scope: 'current_week',
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function asBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function asLessonPlanScope(
  value: unknown,
  fallback: PublishedCourseSiteLessonPlanScope
): PublishedCourseSiteLessonPlanScope {
  return value === 'current_week' || value === 'one_week_ahead' || value === 'all'
    ? value
    : fallback
}

export function normalizePlannedCourseSiteConfig(value: unknown): PlannedCourseSiteConfig {
  const record = asRecord(value)
  return {
    overview: asBoolean(record.overview, DEFAULT_PLANNED_COURSE_SITE_CONFIG.overview),
    outline: asBoolean(record.outline, DEFAULT_PLANNED_COURSE_SITE_CONFIG.outline),
    resources: asBoolean(record.resources, DEFAULT_PLANNED_COURSE_SITE_CONFIG.resources),
    assignments: asBoolean(record.assignments, DEFAULT_PLANNED_COURSE_SITE_CONFIG.assignments),
    quizzes: false,
    tests: asBoolean(record.tests, DEFAULT_PLANNED_COURSE_SITE_CONFIG.tests),
    lesson_plans: asBoolean(record.lesson_plans, DEFAULT_PLANNED_COURSE_SITE_CONFIG.lesson_plans),
  }
}

export function normalizeActualCourseSiteConfig(value: unknown): ActualCourseSiteConfig {
  const record = asRecord(value)
  return {
    ...normalizePlannedCourseSiteConfig(record),
    announcements: asBoolean(record.announcements, DEFAULT_ACTUAL_COURSE_SITE_CONFIG.announcements),
    lesson_plan_scope: asLessonPlanScope(
      record.lesson_plan_scope,
      DEFAULT_ACTUAL_COURSE_SITE_CONFIG.lesson_plan_scope
    ),
  }
}

export function slugifyCourseSiteValue(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

export function summarizeMergeText(value: string, fallback: string) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return fallback
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized
}
