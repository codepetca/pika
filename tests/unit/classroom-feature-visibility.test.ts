import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CLASSROOM_FEATURE_VISIBILITY,
  getAvailableClassroomTabs,
  isClassroomFeatureEffectivelyEnabled,
  isMissingClassroomFeatureVisibilityColumnError,
  isClassroomTabAvailable,
  normalizeClassroomFeatureVisibility,
} from '@/lib/classroom-feature-visibility'

describe('classroom feature visibility', () => {
  it('defaults every optional feature on for existing and partially migrated classrooms', () => {
    expect(normalizeClassroomFeatureVisibility(null)).toEqual(
      DEFAULT_CLASSROOM_FEATURE_VISIBILITY,
    )
    expect(normalizeClassroomFeatureVisibility({ tests: false })).toEqual({
      ...DEFAULT_CLASSROOM_FEATURE_VISIBILITY,
      tests: false,
    })
    expect(normalizeClassroomFeatureVisibility({
      tests: 'false',
      classwork: 0,
      announcements: true,
    })).toEqual({
      ...DEFAULT_CLASSROOM_FEATURE_VISIBILITY,
      announcements: true,
    })
  })

  it('keeps the teacher core while removing disabled optional tabs', () => {
    const visibility = normalizeClassroomFeatureVisibility({
      attendance: false,
      classwork: false,
      tests: false,
      gradebook: true,
      calendar: false,
      syllabus: false,
      announcements: false,
      achievements: false,
    })

    expect(getAvailableClassroomTabs('teacher', visibility, true)).toEqual([
      'daily',
      'roster',
      'settings',
    ])
  })

  it('keeps Today as the student core while removing disabled shared features', () => {
    const visibility = normalizeClassroomFeatureVisibility({
      attendance: false,
      classwork: false,
      tests: false,
      gradebook: false,
      calendar: false,
      syllabus: false,
      announcements: false,
      achievements: false,
    })

    expect(getAvailableClassroomTabs('student', visibility, true)).toEqual(['today'])
  })

  it('preserves tab order and role mappings for enabled features', () => {
    expect(
      getAvailableClassroomTabs('teacher', DEFAULT_CLASSROOM_FEATURE_VISIBILITY, true),
    ).toEqual([
      'daily',
      'attendance',
      'assignments',
      'tests',
      'gradebook',
      'calendar',
      'resources',
      'announcements',
      'roster',
      'settings',
    ])
    expect(
      getAvailableClassroomTabs('student', DEFAULT_CLASSROOM_FEATURE_VISIBILITY, true),
    ).toEqual([
      'today',
      'achievements',
      'assignments',
      'tests',
      'calendar',
      'resources',
      'announcements',
    ])
  })

  it('requires at least one grade source before Gradebook is effectively enabled', () => {
    const noGradeSources = normalizeClassroomFeatureVisibility({
      classwork: false,
      tests: false,
      gradebook: true,
    })
    const classworkOnly = normalizeClassroomFeatureVisibility({
      classwork: true,
      tests: false,
      gradebook: true,
    })

    expect(isClassroomFeatureEffectivelyEnabled(noGradeSources, 'gradebook', true)).toBe(false)
    expect(isClassroomFeatureEffectivelyEnabled(classworkOnly, 'gradebook', true)).toBe(true)
  })

  it('requires Pal and the classroom preference for Achievements', () => {
    const enabled = normalizeClassroomFeatureVisibility({ achievements: true })
    const disabled = normalizeClassroomFeatureVisibility({ achievements: false })

    expect(isClassroomFeatureEffectivelyEnabled(enabled, 'achievements', false)).toBe(false)
    expect(isClassroomFeatureEffectivelyEnabled(enabled, 'achievements', true)).toBe(true)
    expect(isClassroomFeatureEffectivelyEnabled(disabled, 'achievements', true)).toBe(false)
  })

  it('uses the same availability contract for stale or direct tab URLs', () => {
    const visibility = normalizeClassroomFeatureVisibility({
      tests: false,
      syllabus: false,
    })

    expect(isClassroomTabAvailable('teacher', 'tests', visibility, true)).toBe(false)
    expect(isClassroomTabAvailable('student', 'resources', visibility, true)).toBe(false)
    expect(isClassroomTabAvailable('teacher', 'settings', visibility, true)).toBe(true)
    expect(isClassroomTabAvailable('student', 'today', visibility, true)).toBe(true)
    expect(isClassroomTabAvailable('student', 'settings', visibility, true)).toBe(false)
    expect(isClassroomTabAvailable('student', 'unknown', visibility, true)).toBe(false)
  })

  it('recognizes only rollout errors for the feature visibility column', () => {
    expect(isMissingClassroomFeatureVisibilityColumnError({
      code: 'PGRST204',
      message: "Could not find the 'feature_visibility' column",
    })).toBe(true)
    expect(isMissingClassroomFeatureVisibilityColumnError({
      code: '42703',
      message: 'column feature_visibility does not exist',
    })).toBe(true)
    expect(isMissingClassroomFeatureVisibilityColumnError({
      code: 'PGRST204',
      message: "Could not find the 'theme_color' column",
    })).toBe(false)
  })
})
