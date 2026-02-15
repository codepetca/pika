import type { Browser, Page, Frame } from 'playwright'

/** Options for launching the headless browser */
export interface BrowserOptions {
  headless: boolean
  timeout: number // default navigation timeout in ms
}

/** Active Playwright session holding references to browser, page, and frames */
export interface TASession {
  browser: Browser
  page: Page
  mainFrame: Frame
  menuFrame: Frame
}

/** Possible error types during Playwright automation */
export type TAErrorType =
  | 'login_failed'
  | 'course_not_found'
  | 'attendance_form_error'
  | 'student_mismatch'
  | 'timeout'
  | 'browser_error'
