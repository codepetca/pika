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
    expect(config.mainContent.maxWidth).toBe('wide')
  })

  it('should return disabled right sidebar for classrooms-list', () => {
    const config = getLayoutConfig('classrooms-list')
    expect(config.rightSidebar.enabled).toBe(false)
  })

  it('should return disabled right sidebar for settings', () => {
    const config = getLayoutConfig('settings')
    expect(config.rightSidebar.enabled).toBe(false)
  })

  it('should return 50% width for assignments-teacher-viewing', () => {
    const config = getLayoutConfig('assignments-teacher-viewing')
    expect(config.rightSidebar.defaultWidth).toBe('50%')
    expect(config.rightSidebar.defaultOpen).toBe(true)
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
})

describe('getRouteKeyFromTab', () => {
  it('should return correct route key for teacher tabs', () => {
    expect(getRouteKeyFromTab('attendance', 'teacher')).toBe('attendance')
    expect(getRouteKeyFromTab('roster', 'teacher')).toBe('roster')
    expect(getRouteKeyFromTab('settings', 'teacher')).toBe('settings')
  })

  it('should return correct route key for student tabs', () => {
    expect(getRouteKeyFromTab('today', 'student')).toBe('today')
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
      'roster',
      'today',
      'assignments-student',
      'assignments-teacher-list',
      'assignments-teacher-viewing',
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
