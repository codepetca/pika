import { describe, it, expect } from 'vitest'
import {
  LEFT_SIDEBAR,
  ROUTE_CONFIGS,
  getLayoutConfig,
  getRightSidebarCookieName,
  parseLeftSidebarCookie,
  parseRightSidebarCookie,
  getRightSidebarCssWidth,
  getRouteKeyFromTab,
  type RouteKey,
} from '@/lib/layout-config'

describe('LEFT_SIDEBAR constants', () => {
  it('should have correct collapsed width', () => {
    expect(LEFT_SIDEBAR.collapsedWidth).toBe(48)
  })

  it('should have correct expanded width', () => {
    expect(LEFT_SIDEBAR.expandedWidth).toBe(240)
  })
})

describe('getLayoutConfig', () => {
  it('should return config for valid route keys', () => {
    const config = getLayoutConfig('attendance')
    expect(config).toBeDefined()
    expect(config.rightSidebar.enabled).toBe(true)
    expect(config.mainContent.maxWidth).toBe('full')
  })

  it('should return disabled right sidebar for classrooms-list', () => {
    const config = getLayoutConfig('classrooms-list')
    expect(config.rightSidebar.enabled).toBe(false)
  })

  it('should return disabled right sidebar for settings', () => {
    const config = getLayoutConfig('settings')
    expect(config.rightSidebar.enabled).toBe(false)
  })

  it('should return 50% default width for assignments-teacher-viewing (dynamically set to 70% for student work)', () => {
    const config = getLayoutConfig('assignments-teacher-viewing')
    expect(config.rightSidebar.defaultWidth).toBe('50%')
    expect(config.rightSidebar.defaultOpen).toBe(true)
    expect(config.rightSidebar.desktopAlwaysOpen).toBe(true)
  })

  it('should only force desktopAlwaysOpen while viewing teacher work', () => {
    const listConfig = getLayoutConfig('assignments-teacher-list')
    const viewingConfig = getLayoutConfig('assignments-teacher-viewing')
    expect(listConfig.rightSidebar.desktopAlwaysOpen).toBeUndefined()
    expect(viewingConfig.rightSidebar.desktopAlwaysOpen).toBe(true)
  })

  it('should use a persistent two-pane layout for resources tabs', () => {
    const teacherConfig = getLayoutConfig('resources-teacher')
    const studentConfig = getLayoutConfig('resources-student')

    expect(teacherConfig.rightSidebar.enabled).toBe(true)
    expect(teacherConfig.rightSidebar.defaultOpen).toBe(true)
    expect(teacherConfig.rightSidebar.defaultWidth).toBe('50%')
    expect(teacherConfig.rightSidebar.desktopAlwaysOpen).toBe(true)

    expect(studentConfig.rightSidebar.enabled).toBe(true)
    expect(studentConfig.rightSidebar.defaultOpen).toBe(true)
    expect(studentConfig.rightSidebar.defaultWidth).toBe('50%')
    expect(studentConfig.rightSidebar.desktopAlwaysOpen).toBe(true)
  })

  it('should not reserve external sidebars for teacher gradebook, quizzes, and tests', () => {
    const gradebookConfig = getLayoutConfig('gradebook')
    const quizzesConfig = getLayoutConfig('quizzes-teacher')
    const testsConfig = getLayoutConfig('tests-teacher')

    expect(gradebookConfig.rightSidebar.enabled).toBe(false)
    expect(gradebookConfig.rightSidebar.defaultOpen).toBe(false)
    expect(gradebookConfig.mainContent.maxWidth).toBe('full')

    expect(quizzesConfig.rightSidebar.enabled).toBe(false)
    expect(quizzesConfig.rightSidebar.defaultOpen).toBe(false)
    expect(quizzesConfig.mainContent.maxWidth).toBe('full')

    expect(testsConfig.rightSidebar.enabled).toBe(false)
    expect(testsConfig.rightSidebar.defaultOpen).toBe(false)
    expect(testsConfig.mainContent.maxWidth).toBe('full')
  })
})

describe('getRightSidebarCookieName', () => {
  it('should generate correct cookie name', () => {
    expect(getRightSidebarCookieName('attendance')).toBe('pika_right_sidebar_attendance')
    expect(getRightSidebarCookieName('roster')).toBe('pika_right_sidebar_roster')
  })
})

describe('parseLeftSidebarCookie', () => {
  it('should return true when value is "expanded"', () => {
    expect(parseLeftSidebarCookie('expanded')).toBe(true)
  })

  it('should return false when value is "collapsed"', () => {
    expect(parseLeftSidebarCookie('collapsed')).toBe(false)
  })

  it('should return false when value is undefined', () => {
    expect(parseLeftSidebarCookie(undefined)).toBe(false)
  })

  it('should return false when value is empty string', () => {
    expect(parseLeftSidebarCookie('')).toBe(false)
  })

  it('should return false for any other value', () => {
    expect(parseLeftSidebarCookie('open')).toBe(false)
    expect(parseLeftSidebarCookie('true')).toBe(false)
  })
})

describe('parseRightSidebarCookie', () => {
  it('should return true when value is "open"', () => {
    expect(parseRightSidebarCookie('open')).toBe(true)
  })

  it('should return false when value is "closed"', () => {
    expect(parseRightSidebarCookie('closed')).toBe(false)
  })

  it('should return false when value is undefined', () => {
    expect(parseRightSidebarCookie(undefined)).toBe(false)
  })

  it('should return false for any other value', () => {
    expect(parseRightSidebarCookie('expanded')).toBe(false)
    expect(parseRightSidebarCookie('true')).toBe(false)
  })
})

describe('getRightSidebarCssWidth', () => {
  it('should return pixel value for numeric widths', () => {
    expect(getRightSidebarCssWidth(320)).toBe('320px')
    expect(getRightSidebarCssWidth(360)).toBe('360px')
    expect(getRightSidebarCssWidth(420)).toBe('420px')
  })

  it('should return percentage for 50%', () => {
    expect(getRightSidebarCssWidth('50%')).toBe('50%')
  })

  it('should return percentage for 60%', () => {
    expect(getRightSidebarCssWidth('60%')).toBe('60%')
  })

  it('should return arbitrary percentage widths', () => {
    expect(getRightSidebarCssWidth('76.4%')).toBe('76.4%')
  })
})

describe('getRouteKeyFromTab', () => {
  it('should return correct route key for teacher tabs', () => {
    expect(getRouteKeyFromTab('attendance', 'teacher')).toBe('attendance')
    expect(getRouteKeyFromTab('gradebook', 'teacher')).toBe('gradebook')
    expect(getRouteKeyFromTab('roster', 'teacher')).toBe('roster')
    expect(getRouteKeyFromTab('settings', 'teacher')).toBe('settings')
  })

  it('should return correct route key for student tabs', () => {
    expect(getRouteKeyFromTab('today', 'student')).toBe('today')
    expect(getRouteKeyFromTab('tests', 'student')).toBe('tests-student')
  })

  it('should return assignments-student for student assignments', () => {
    expect(getRouteKeyFromTab('assignments', 'student')).toBe('assignments-student')
  })

  it('should return assignments-teacher-list for teacher assignments without viewing work', () => {
    expect(getRouteKeyFromTab('assignments', 'teacher')).toBe('assignments-teacher-list')
    expect(getRouteKeyFromTab('assignments', 'teacher', false)).toBe('assignments-teacher-list')
  })

  it('should return assignments-teacher-viewing for teacher viewing work', () => {
    expect(getRouteKeyFromTab('assignments', 'teacher', true)).toBe('assignments-teacher-viewing')
  })

  it('should map tests tab to dedicated tests route keys for both roles', () => {
    expect(getRouteKeyFromTab('tests', 'teacher')).toBe('tests-teacher')
    expect(getRouteKeyFromTab('tests', 'student')).toBe('tests-student')
  })

  it('should return default for unknown tabs', () => {
    expect(getRouteKeyFromTab('unknown', 'teacher')).toBe('attendance')
    expect(getRouteKeyFromTab('unknown', 'student')).toBe('today')
  })
})

describe('ROUTE_CONFIGS', () => {
  it('should have all expected route keys', () => {
    const expectedKeys: RouteKey[] = [
      'classrooms-list',
      'settings',
      'attendance',
      'gradebook',
      'roster',
      'today',
      'assignments-student',
      'assignments-teacher-list',
      'assignments-teacher-viewing',
      'quizzes-teacher',
      'quizzes-student',
      'tests-teacher',
      'tests-student',
      'calendar-teacher',
      'calendar-student',
      'resources-teacher',
      'resources-student',
    ]

    expectedKeys.forEach((key) => {
      expect(ROUTE_CONFIGS[key]).toBeDefined()
    })
  })

  it('should have valid configs for all routes', () => {
    Object.entries(ROUTE_CONFIGS).forEach(([key, config]) => {
      expect(config.rightSidebar).toBeDefined()
      expect(typeof config.rightSidebar.enabled).toBe('boolean')
      expect(typeof config.rightSidebar.defaultOpen).toBe('boolean')
      expect(config.mainContent).toBeDefined()
      expect(['reading', 'standard', 'wide', 'full']).toContain(config.mainContent.maxWidth)
    })
  })
})
