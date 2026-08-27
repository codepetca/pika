import { describe, expect, it } from 'vitest'
import {
  getCourseGuidePublicSharingReadiness,
  hasCourseGuideContent,
  type CourseGuideData,
} from '@/lib/course-guide'

const visibleConfig = {
  overview: true,
  outline: true,
  resources: true,
  assignments: true,
  tests: true,
  lesson_plans: true,
  announcements: true,
  lesson_plan_scope: 'current_week' as const,
}

const guide: CourseGuideData = {
  classroom: {
    title: 'Computer Science',
    classCode: 'ICS4U',
  },
  visibility: visibleConfig,
  overviewMarkdown: 'Course overview',
  resourcesContent: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Course links' }] }],
  },
  assignments: [{
    key: 'assignment:0',
    title: 'Portfolio',
    instructionsMarkdown: 'Build a portfolio.',
    dueAt: '2026-10-15T03:59:00.000Z',
    pointsPossible: 30,
    includeInFinal: true,
    courseWeightPercent: 25,
    position: 0,
  }],
  tests: [{
    key: 'test:0',
    title: 'Programming Test',
    pointsPossible: 50,
    includeInFinal: true,
    courseWeightPercent: 75,
    position: 0,
    documents: [{ key: 'document:0', title: 'Review sheet', href: 'https://example.com/review' }],
  }],
  lessonPlans: [{
    key: 'lesson:2026-09-10',
    contentMarkdown: 'Variables and data types',
  }],
  announcements: [{
    key: 'announcement:1',
    title: 'Welcome',
    content: 'Bring your laptop.',
    publishedAt: '2026-09-01T14:00:00.000Z',
  }],
}

describe('course guide', () => {
  it('requires an address only when public sharing is enabled', () => {
    expect(getCourseGuidePublicSharingReadiness({
      enabled: false,
      slug: '',
    })).toEqual({
      ready: true,
      missing: [],
    })
    expect(getCourseGuidePublicSharingReadiness({
      enabled: true,
      slug: '',
    })).toEqual({
      ready: false,
      missing: ['Public page address'],
    })
    expect(getCourseGuidePublicSharingReadiness({
      enabled: true,
      slug: 'computer-science',
    })).toEqual({
      ready: true,
      missing: [],
    })
  })

  it('detects whether any enabled section contains guide content', () => {
    expect(hasCourseGuideContent(guide)).toBe(true)

    expect(hasCourseGuideContent({
      ...guide,
      overviewMarkdown: '',
      resourcesContent: null,
      assignments: [],
      tests: [],
      lessonPlans: [],
      announcements: [],
    })).toBe(false)

    expect(hasCourseGuideContent({
      ...guide,
      overviewMarkdown: '',
      resourcesContent: null,
      assignments: [],
      tests: [],
      lessonPlans: [],
      announcements: [],
    })).toBe(false)
  })
})
