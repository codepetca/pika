import { z } from 'zod'

/**
 * Shared email validation: required string, email format, lowercased and trimmed.
 */
const emailField = z.string().email('Invalid email format').transform(v => v.toLowerCase().trim())

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
}).refine(data => data.password === data.passwordConfirmation, {
  message: 'Passwords do not match',
  path: ['passwordConfirmation'],
})
