import { z } from 'zod'
import { isSafeInternalPath } from '@/lib/navigation-safety'

/**
 * Shared email validation: required string, email format, lowercased and trimmed.
 */
const emailField = z.string().trim().toLowerCase().email('Invalid email format')
const handoffTokenField = z.preprocess(
  value => (typeof value === 'string' ? value.trim() : ''),
  z.string().min(32, 'Verification session is required'),
)

/**
 * POST /api/auth/signup
 */
export const signupSchema = z.object({
  email: emailField,
})

/**
 * POST /api/auth/verify-signup
 */
export const verifySignupSchema = z.object({
  email: emailField,
  code: z.string().min(1, 'Code is required').transform(v => v.toUpperCase().trim()),
})

/**
 * POST /api/auth/create-password
 */
export const createPasswordSchema = z.object({
  email: emailField,
  password: z.string().min(8, 'Password must be at least 8 characters'),
  passwordConfirmation: z.string().min(1, 'Password confirmation is required'),
  handoffToken: handoffTokenField,
}).refine(data => data.password === data.passwordConfirmation, {
  message: 'Passwords do not match',
  path: ['passwordConfirmation'],
})

/**
 * POST /api/auth/login
 */
export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'Password is required'),
})

const safeNextPath = z.string().trim().refine(
  isSafeInternalPath,
  'Invalid return path',
)

/**
 * POST /api/auth/workos/magic/start
 */
export const startWorkOSMagicAuthSchema = z.object({
  email: emailField,
  intent: z.enum(['sign-in', 'sign-up']).default('sign-in'),
  next: safeNextPath.optional(),
})

/**
 * POST /api/auth/workos/magic/verify
 */
export const verifyWorkOSMagicAuthSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the six-digit code'),
})

/**
 * POST /api/auth/workos/session/restore
 */
export const restoreWorkOSSessionSchema = z.object({
  next: safeNextPath.optional(),
})

/**
 * POST /api/auth/forgot-password
 */
export const forgotPasswordSchema = z.object({
  email: emailField,
})

/**
 * POST /api/auth/reset-password/verify
 */
export const resetPasswordVerifySchema = z.object({
  email: emailField,
  code: z.string().min(1, 'Code is required').transform(v => v.toUpperCase().trim()),
})

/**
 * POST /api/auth/reset-password/confirm
 */
export const resetPasswordConfirmSchema = z.object({
  email: emailField,
  password: z.string().min(8, 'Password must be at least 8 characters'),
  passwordConfirmation: z.string().min(1, 'Password confirmation is required'),
  handoffToken: handoffTokenField,
}).refine(data => data.password === data.passwordConfirmation, {
  message: 'Passwords do not match',
  path: ['passwordConfirmation'],
})
