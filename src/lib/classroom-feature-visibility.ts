export const CLASSROOM_FEATURE_KEYS = [
  'attendance',
  'classwork',
  'tests',
  'gradebook',
  'student_grades',
  'calendar',
  'syllabus',
  'announcements',
  'achievements',
] as const

export type ClassroomFeatureKey = (typeof CLASSROOM_FEATURE_KEYS)[number]

export type ClassroomFeatureVisibility = Record<ClassroomFeatureKey, boolean> & {
  /** Retained for persisted/older-client compatibility; compact display replaces hiding. */
  gradebook_hide_zero_weight_student?: boolean
  gradebook_compact_zero_weight_assessments?: boolean
}

export type ClassroomTabId =
  | 'daily'
  | 'attendance'
  | 'gradebook'
  | 'grades'
  | 'assignments'
  | 'tests'
  | 'blueprint'
  | 'calendar'
  | 'resources'
  | 'announcements'
  | 'roster'
  | 'settings'
  | 'today'
  | 'achievements'

type ClassroomRole = 'student' | 'teacher'

export const DEFAULT_CLASSROOM_FEATURE_VISIBILITY: ClassroomFeatureVisibility = {
  attendance: true,
  classwork: true,
  tests: true,
  gradebook: true,
  student_grades: false,
  gradebook_hide_zero_weight_student: false,
  gradebook_compact_zero_weight_assessments: true,
  calendar: true,
  syllabus: true,
  announcements: true,
  achievements: true,
}

const TEACHER_TABS: readonly ClassroomTabId[] = [
  'daily',
  'assignments',
  'tests',
  'blueprint',
  'gradebook',
  'calendar',
  'resources',
  'announcements',
  'roster',
  'settings',
]

const STUDENT_TABS: readonly ClassroomTabId[] = [
  'today',
  'achievements',
  'assignments',
  'tests',
  'grades',
  'calendar',
  'resources',
  'announcements',
]

const TAB_FEATURES: Partial<Record<ClassroomTabId, ClassroomFeatureKey>> = {
  attendance: 'attendance',
  assignments: 'classwork',
  tests: 'tests',
  gradebook: 'gradebook',
  grades: 'student_grades',
  calendar: 'calendar',
  resources: 'syllabus',
  announcements: 'announcements',
  achievements: 'achievements',
}

export function normalizeClassroomFeatureVisibility(value: unknown): ClassroomFeatureVisibility {
  const candidate = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

  return {
    gradebook_hide_zero_weight_student: candidate.gradebook_hide_zero_weight_student === true,
    gradebook_compact_zero_weight_assessments: typeof candidate.gradebook_compact_zero_weight_assessments === 'boolean'
      ? candidate.gradebook_compact_zero_weight_assessments
      : true,
    ...Object.fromEntries(
      CLASSROOM_FEATURE_KEYS.map((key) => [
        key,
        typeof candidate[key] === 'boolean'
          ? candidate[key]
          : DEFAULT_CLASSROOM_FEATURE_VISIBILITY[key],
      ]),
    ),
  } as ClassroomFeatureVisibility
}

export function isClassroomFeatureEffectivelyEnabled(
  visibility: ClassroomFeatureVisibility,
  feature: ClassroomFeatureKey,
  palEnabled: boolean,
): boolean {
  if (!visibility[feature]) return false
  if (feature === 'gradebook') return visibility.classwork || visibility.tests
  if (feature === 'student_grades') return visibility.classwork || visibility.tests
  if (feature === 'achievements') return palEnabled
  return true
}

export function getAvailableClassroomTabs(
  role: ClassroomRole,
  visibility: ClassroomFeatureVisibility,
  palEnabled: boolean,
): ClassroomTabId[] {
  const tabs = role === 'teacher' ? TEACHER_TABS : STUDENT_TABS

  return tabs.filter((tab) => {
    const feature = TAB_FEATURES[tab]
    return feature
      ? isClassroomFeatureEffectivelyEnabled(visibility, feature, palEnabled)
      : true
  })
}

export function isClassroomTabAvailable(
  role: ClassroomRole,
  tab: string | null | undefined,
  visibility: ClassroomFeatureVisibility,
  palEnabled: boolean,
): tab is ClassroomTabId {
  if (!tab) return false
  return getAvailableClassroomTabs(role, visibility, palEnabled).includes(tab as ClassroomTabId)
}

export function isMissingClassroomFeatureVisibilityColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; message?: unknown; details?: unknown }
  const code = typeof candidate.code === 'string' ? candidate.code : ''
  const message = `${candidate.message || ''} ${candidate.details || ''}`.toLowerCase()

  return (
    (code === 'PGRST204' || code === '42703') &&
    message.includes('feature_visibility')
  )
}
