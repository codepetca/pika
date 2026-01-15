/**
 * Types for AI-invokable verification scripts
 */

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
  run: (page: any, baseUrl: string) => Promise<VerificationResult>
}
