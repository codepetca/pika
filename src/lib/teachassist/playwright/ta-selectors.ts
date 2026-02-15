/**
 * Central selector registry for TeachAssist page elements.
 * All CSS selectors and frame names live here so Playwright automation
 * modules reference a single source of truth.
 */

// ---------------------------------------------------------------------------
// Frame names (used with page.frame())
// ---------------------------------------------------------------------------
export const FRAMES = {
  menu: 'menuFrame',
  main: 'mainFrame',
} as const

// ---------------------------------------------------------------------------
// Login page (https://ta.yrdsb.ca/yrdsb/)
// ---------------------------------------------------------------------------
export const LOGIN = {
  usernameInput: 'input[name="username"]',
  passwordInput: 'input[name="password"]',
  submitButton: 'input[type="submit"], button[type="submit"]',
} as const

// ---------------------------------------------------------------------------
// Attendance page (/live/adminAttendance.php inside mainFrame)
// ---------------------------------------------------------------------------
export const ATTENDANCE = {
  dateInput: 'input[name="inputDate"]',
  blockSelect: 'select[name="block"]',
  recordButton: 'input[value="Record Attendance"]',
  prevDateButton: 'input[name="prevdate"]',

  /** Selector for a specific radio button given its name and value */
  radio: (radioName: string, status: string): string =>
    `input[name="${radioName}"][value="${status}"]`,

  /** Selector for text comment field given its name */
  comment: (commentName: string): string => `input[name="${commentName}"]`,
} as const

// ---------------------------------------------------------------------------
// Navigation tabs (inside mainFrame, after course selection)
// ---------------------------------------------------------------------------
export const TABS = {
  students: 'Students',
  attendance: 'Attendance',
  assessment: 'Assessment',
  reports: 'Reports',
} as const
