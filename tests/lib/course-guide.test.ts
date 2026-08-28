import { describe, expect, it } from 'vitest'
import {
  getCourseGuidePublicSharingReadiness,
  hasCourseGuideContent,
  type CourseGuideData,
} from '@/lib/course-guide'

const visibleConfig = {
  overview: true,
  resources: true,
  assignments: true,
  tests: true,
}

const guide: CourseGuideData = {
  classroom: {
    title: 'Computer Science',
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
  }],
  tests: [{
    key: 'test:0',
    title: 'Programming Test',
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
    })).toBe(false)
  })
})
