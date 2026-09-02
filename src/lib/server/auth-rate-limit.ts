import { createHmac } from 'node:crypto'
import { isIP } from 'node:net'
import { z } from 'zod'
import { ApiError } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'

const resultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({
    ok: z.literal(false),
    retry_after_seconds: z.number().int().positive(),
  }),
])

export type AuthRateLimitAction =
  | 'login'
  | 'signup_code'
  | 'signup_verify'
  | 'signup_confirm'
  | 'reset_code'
  | 'reset_verify'
  | 'reset_confirm'

export type AuthRateLimitScope =
  | `${AuthRateLimitAction}_identifier`
  | `${AuthRateLimitAction}_client`
  | 'auth_global'

type RateLimitClient = Pick<ReturnType<typeof getServiceRoleClient>, 'rpc'>

function getRateLimitSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters')
  }
  return secret
}

export function hashAuthRateLimitKey(scope: AuthRateLimitScope, value: string): string {
  return createHmac('sha256', getRateLimitSecret())
    .update(`${scope}\0${value.trim().toLowerCase()}`, 'utf8')
    .digest('hex')
}

export function getAuthClientFingerprint(request: Request): string {
  const forwarded = process.env.NODE_ENV === 'production'
    ? request.headers.get('x-vercel-forwarded-for')
    : request.headers.get('x-vercel-forwarded-for')
      || request.headers.get('x-forwarded-for')
      || request.headers.get('x-real-ip')
  const candidate = forwarded?.split(',')[0]?.trim() || ''
  return isIP(candidate) ? `ip:${candidate}` : 'unresolved-client'
}

export async function consumeAuthRequestRateLimits(args: {
  action: AuthRateLimitAction
  request: Request
  identifier: string
  identifierMaxAttempts: number
  clientMaxAttempts: number
  windowSeconds: number
  supabase?: RateLimitClient
}): Promise<void> {
  const supabase = args.supabase || getServiceRoleClient()
  await consumeAuthRateLimit({
    scope: `${args.action}_client`,
    value: getAuthClientFingerprint(args.request),
    maxAttempts: args.clientMaxAttempts,
    windowSeconds: args.windowSeconds,
    supabase,
  })
  await consumeAuthGlobalRateLimit({ supabase })
  await consumeAuthRateLimit({
    scope: `${args.action}_identifier`,
    value: args.identifier,
    maxAttempts: args.identifierMaxAttempts,
    windowSeconds: args.windowSeconds,
    supabase,
  })
}

async function consumeAuthGlobalRateLimit(args: {
  supabase: RateLimitClient
}): Promise<void> {
  const { data, error } = await args.supabase.rpc('consume_auth_global_rate_limit', {
    p_key_hash: hashAuthRateLimitKey('auth_global', 'all-authentication-requests'),
    p_max_attempts: 10_000,
    p_window_seconds: 60,
  })

  const parsed = resultSchema.safeParse(data)
  if (error || !parsed.success) {
    console.error('Authentication overload guard failed:', error || parsed.error)
    throw new ApiError(503, 'Authentication is temporarily unavailable')
  }
  if (!parsed.data.ok) {
    throw new ApiError(429, 'Too many attempts. Please try again later.')
  }
}

export async function consumeAuthRateLimit(args: {
  scope: AuthRateLimitScope
  value: string
  maxAttempts: number
  windowSeconds: number
  supabase?: RateLimitClient
}): Promise<void> {
  const supabase = args.supabase || getServiceRoleClient()
  const keyHash = hashAuthRateLimitKey(args.scope, args.value)
  const { data, error } = await supabase.rpc('consume_auth_rate_limit', {
    p_scope: args.scope,
    p_key_hash: keyHash,
    p_max_attempts: args.maxAttempts,
    p_window_seconds: args.windowSeconds,
  })

  const parsed = resultSchema.safeParse(data)
  if (error || !parsed.success) {
    console.error('Authentication rate limit failed:', error || parsed.error)
    throw new ApiError(503, 'Authentication is temporarily unavailable')
  }
  if (!parsed.data.ok) {
    throw new ApiError(429, 'Too many attempts. Please try again later.')
  }
}

export async function clearAuthRateLimit(args: {
  scope: AuthRateLimitScope
  value: string
  supabase?: RateLimitClient
}): Promise<void> {
  const supabase = args.supabase || getServiceRoleClient()
  const { data, error } = await supabase.rpc('clear_auth_rate_limit', {
    p_scope: args.scope,
    p_key_hash: hashAuthRateLimitKey(args.scope, args.value),
  })
  if (error || data !== true) {
    console.error('Authentication rate limit reset failed:', error || data)
    throw new ApiError(503, 'Authentication is temporarily unavailable')
  }
}
