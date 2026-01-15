/**
 * Types for AI-invokable verification scripts
 */
import type { Page } from '@playwright/test'

export interface VerificationCheck {
  name: string
  passed: boolean
  message?: string
}

export interface VerificationResult {
  scenario: string
  passed: boolean
  checks: VerificationCheck[]
  screenshots?: string[]
  error?: string
}

export interface VerificationScript {
  name: string
  description: string
  role: 'teacher' | 'student' | 'unauthenticated'
  run: (page: Page, baseUrl: string) => Promise<VerificationResult>
}
