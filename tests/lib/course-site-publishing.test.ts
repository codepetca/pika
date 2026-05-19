import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ACTUAL_COURSE_SITE_CONFIG,
  DEFAULT_PLANNED_COURSE_SITE_CONFIG,
  normalizeActualCourseSiteConfig,
  normalizePlannedCourseSiteConfig,
  slugifyCourseSiteValue,
  summarizeMergeText,
} from '@/lib/course-site-publishing'

describe('course-site-publishing', () => {
  it('fills missing planned site flags with defaults and keeps quizzes hidden', () => {
    expect(normalizePlannedCourseSiteConfig({ overview: false, quizzes: true })).toEqual({
      ...DEFAULT_PLANNED_COURSE_SITE_CONFIG,
      overview: false,
      quizzes: false,
    })
  })

  it('fills missing actual site flags and validates lesson plan scope', () => {
    expect(normalizeActualCourseSiteConfig({ announcements: false, lesson_plan_scope: 'invalid' })).toEqual({
      ...DEFAULT_ACTUAL_COURSE_SITE_CONFIG,
      announcements: false,
    })
  })

  it('slugifies course site values and summarizes long text', () => {
    expect(slugifyCourseSiteValue('  CS 11: Semester 1  ')).toBe('cs-11-semester-1')
    expect(summarizeMergeText('   ', 'Fallback')).toBe('Fallback')
    expect(summarizeMergeText('A'.repeat(140), 'Fallback')).toBe(`${'A'.repeat(117)}...`)
  })
})
