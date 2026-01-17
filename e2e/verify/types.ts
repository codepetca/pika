/**
 * Types for AI-invokable verification scripts
 */
import type { Page } from '@playwright/test'

/** Default timeouts for verification scripts (in ms) */
export const TIMEOUTS = {
  /** Timeout for elements to become visible */
  ELEMENT_VISIBLE: 10000,
  /** Timeout for navigation/URL changes */
  NAVIGATION: 15000,
} as const

export interface VerificationCheck {
  name: string
  passed: boolean
  message?: string
}

export interface VerificationResult {
  scenario: string
  passed: boolean
  checks: VerificationCheck[]
  error?: string
}

export interface VerificationScript {
  name: string
  description: string
  role: 'teacher' | 'student' | 'unauthenticated'
  run: (page: Page, baseUrl: string) => Promise<VerificationResult>
}
