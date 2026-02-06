/**
 * Layout configuration for 3-panel AppShell
 *
 * This file defines types and per-route defaults for the layout system.
 * To change layout behavior for a route, edit the ROUTE_CONFIGS below.
 */

// ============================================================================
// Types
// ============================================================================

export type RightSidebarWidth = 320 | 360 | 420 | '40%' | '50%' | '60%' | '70%' | '75%'

export type MainContentMaxWidth = 'reading' | 'standard' | 'wide' | 'full'

/**
 * Tailwind 'lg' breakpoint in pixels.
 * Used for detecting desktop vs mobile for sidebar behavior.
 */
export const DESKTOP_BREAKPOINT = 1024

export type LayoutConfig = {
  rightSidebar: {
    /** false = no panel, no toggle button */
    enabled: boolean
    /** Whether the panel is open by default */
    defaultOpen: boolean
    /** Default width when open */
    defaultWidth: RightSidebarWidth
    /** Panel always visible on desktop, no toggle button */
    desktopAlwaysOpen?: boolean
  }
  mainContent: {
    /** Max width constraint for main content area */
    maxWidth: MainContentMaxWidth
  }
}

export type RouteKey =
  | 'classrooms-list'
  | 'settings'
  | 'attendance'
  | 'roster'
  | 'today'
  | 'assignments-student'
  | 'assignments-teacher-list'
  | 'assignments-teacher-viewing'
  | 'quizzes-teacher'
  | 'quizzes-student'
  | 'calendar-teacher'
  | 'calendar-student'
  | 'resources-teacher'
  | 'resources-student'

// ============================================================================
// Constants
// ============================================================================

export const LEFT_SIDEBAR = {
  /** Width when collapsed (icon rail only) */
  collapsedWidth: 48,
  /** Width when expanded (icons + labels) */
  expandedWidth: 240,
} as const

export const RIGHT_SIDEBAR_WIDTHS: Record<320 | 360 | 420, number> = {
  320: 320,
  360: 360,
  420: 420,
}

export const MAIN_CONTENT_MAX_WIDTHS: Record<MainContentMaxWidth, string> = {
  reading: 'max-w-2xl', // ~672px - optimal for reading
  standard: 'max-w-4xl', // ~896px - standard content
  wide: 'max-w-7xl', // ~1280px - wide layouts
  full: 'max-w-none', // no constraint
}

// ============================================================================
// Per-Route Defaults
// ============================================================================

export const ROUTE_CONFIGS: Record<RouteKey, LayoutConfig> = {
  'classrooms-list': {
    rightSidebar: { enabled: false, defaultOpen: false, defaultWidth: 320 },
    mainContent: { maxWidth: 'standard' },
  },
  settings: {
    rightSidebar: { enabled: false, defaultOpen: false, defaultWidth: 320 },
    mainContent: { maxWidth: 'full' },
  },
  attendance: {
    rightSidebar: { enabled: true, defaultOpen: true, defaultWidth: '50%' },
    mainContent: { maxWidth: 'full' },
  },
  roster: {
    rightSidebar: { enabled: true, defaultOpen: false, defaultWidth: 320 },
    mainContent: { maxWidth: 'wide' },
  },
  today: {
    rightSidebar: { enabled: true, defaultOpen: true, defaultWidth: 360 },
    mainContent: { maxWidth: 'reading' },
  },
  'assignments-student': {
    rightSidebar: { enabled: false, defaultOpen: false, defaultWidth: '40%' },
    mainContent: { maxWidth: 'full' },
  },
  'assignments-teacher-list': {
    rightSidebar: { enabled: true, defaultOpen: true, defaultWidth: '50%', desktopAlwaysOpen: true },
    mainContent: { maxWidth: 'full' },
  },
  'assignments-teacher-viewing': {
    rightSidebar: { enabled: true, defaultOpen: true, defaultWidth: '50%', desktopAlwaysOpen: true },
    mainContent: { maxWidth: 'full' },
  },
  'quizzes-teacher': {
    rightSidebar: { enabled: true, defaultOpen: true, defaultWidth: '50%' },
    mainContent: { maxWidth: 'full' },
  },
  'quizzes-student': {
    rightSidebar: { enabled: false, defaultOpen: false, defaultWidth: 320 },
    mainContent: { maxWidth: 'reading' },
  },
  'calendar-teacher': {
    rightSidebar: { enabled: true, defaultOpen: false, defaultWidth: '50%' },
    mainContent: { maxWidth: 'full' },
  },
  'calendar-student': {
    rightSidebar: { enabled: false, defaultOpen: false, defaultWidth: 320 },
    mainContent: { maxWidth: 'full' },
  },
  'resources-teacher': {
    rightSidebar: { enabled: false, defaultOpen: false, defaultWidth: 320 },
    mainContent: { maxWidth: 'full' },
  },
  'resources-student': {
    rightSidebar: { enabled: false, defaultOpen: false, defaultWidth: 320 },
    mainContent: { maxWidth: 'reading' },
  },
}

// ============================================================================
// Cookie Names
// ============================================================================

export const COOKIE_NAMES = {
  leftSidebar: 'pika_left_sidebar',
  rightSidebarPrefix: 'pika_right_sidebar_',
} as const

// ============================================================================
// Utilities
// ============================================================================

/**
 * Get the layout config for a route key
 */
export function getLayoutConfig(routeKey: RouteKey): LayoutConfig {
  return ROUTE_CONFIGS[routeKey]
}

/**
 * Get the right sidebar cookie name for a view
 */
export function getRightSidebarCookieName(viewKey: string): string {
  return `${COOKIE_NAMES.rightSidebarPrefix}${viewKey}`
}

/**
 * Parse left sidebar state from cookie value
 */
export function parseLeftSidebarCookie(value: string | undefined): boolean {
  // Returns true if expanded, false if collapsed
  // Default to collapsed (false) if no cookie
  return value === 'expanded'
}

/**
 * Parse right sidebar state from cookie value
 */
export function parseRightSidebarCookie(value: string | undefined): boolean {
  // Returns true if open, false if closed
  return value === 'open'
}

/**
 * Calculate the CSS width value for right sidebar
 */
export function getRightSidebarCssWidth(width: RightSidebarWidth): string {
  if (typeof width === 'string') return width // percentage values
  return `${width}px`
}

/**
 * Map tab name to route key
 */
export function getRouteKeyFromTab(
  tab: string,
  role: 'student' | 'teacher',
  isViewingWork?: boolean
): RouteKey {
  if (tab === 'settings') return 'settings'
  if (tab === 'attendance') return 'attendance'
  if (tab === 'roster') return 'roster'
  if (tab === 'today') return 'today'

  if (tab === 'calendar') {
    return role === 'teacher' ? 'calendar-teacher' : 'calendar-student'
  }

  if (tab === 'resources') {
    return role === 'teacher' ? 'resources-teacher' : 'resources-student'
  }

  if (tab === 'assignments') {
    if (role === 'student') return 'assignments-student'
    if (isViewingWork) return 'assignments-teacher-viewing'
    return 'assignments-teacher-list'
  }

  if (tab === 'quizzes') {
    return role === 'teacher' ? 'quizzes-teacher' : 'quizzes-student'
  }

  // Default fallback
  return role === 'teacher' ? 'attendance' : 'today'
}
