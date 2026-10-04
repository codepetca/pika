import { z } from 'zod'
import { generateHandoffToken, hashHandoffToken, verifyCode } from '@/lib/crypto'
import type { getServiceRoleClient } from '@/lib/supabase'
import { DUMMY_AUTH_BCRYPT_HASH } from '@/lib/server/auth-response'

export type AuthVerificationPurpose = 'signup' | 'reset_password'
type ServiceRoleClient = ReturnType<typeof getServiceRoleClient>

const generationSchema = z.number().int().positive()
const issueResultSchema = z.object({ ok: z.boolean() })
const candidateSchema = z.object({
  id: z.string().uuid(),
  generation: generationSchema,
  code_hash: z.string().min(1),
  attempts: z.number().int().nonnegative(),
  used_at: z.string().nullable(),
  expires_at: z.string(),
})
const finalizationSchema = z.object({
  ok: z.boolean(),
  user_id: z.string().uuid().optional(),
  generation: generationSchema.optional(),
})
const handoffSchema = z.object({
  user_id: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(['student', 'teacher']),
  generation: generationSchema,
  credential_version: generationSchema,
  email_verified: z.boolean(),
  password_set: z.boolean(),
})

export type AuthVerificationCandidate = z.infer<typeof candidateSchema>
export type AuthHandoffInspection = z.infer<typeof handoffSchema>
export const NONEXISTENT_AUTH_CODE_ID = '00000000-0000-0000-0000-000000000001'

export async function issueAuthVerificationCode(
  supabase: ServiceRoleClient,
  input: {
    userId: string
    purpose: AuthVerificationPurpose
    codeHash: string
    expiresAt: string
  },
) {
  const response = await supabase.rpc('issue_auth_verification_code_v1', {
    p_user_id: input.userId,
    p_purpose: input.purpose,
    p_code_hash: input.codeHash,
    p_expires_at: input.expiresAt,
  })
  return {
    error: response.error,
    result: response.error ? null : issueResultSchema.parse(response.data),
  }
}

export async function getLatestAuthVerificationCode(
  supabase: ServiceRoleClient,
  input: { userId: string; purpose: AuthVerificationPurpose },
) {
  const response = await supabase.rpc('get_latest_auth_verification_code_v1', {
    p_user_id: input.userId,
    p_purpose: input.purpose,
  })
  return {
    error: response.error,
    candidate: response.error || response.data === null
      ? null
      : candidateSchema.parse(response.data),
  }
}

export async function finalizeAuthVerificationAttempt(
  supabase: ServiceRoleClient,
  input: {
    userId: string
    purpose: AuthVerificationPurpose
    candidateId: string
    candidateGeneration: number
    codeMatched: boolean
    handoffTokenHash: string | null
    handoffExpiresAt: string | null
    maxAttempts: number
  },
) {
  const response = await supabase.rpc('finalize_auth_verification_attempt_v1', {
    p_user_id: input.userId,
    p_purpose: input.purpose,
    p_candidate_id: input.candidateId,
    p_candidate_generation: input.candidateGeneration,
    p_code_matched: input.codeMatched,
    p_handoff_token_hash: input.handoffTokenHash,
    p_handoff_expires_at: input.handoffExpiresAt,
    p_max_attempts: input.maxAttempts,
  })
  return {
    error: response.error,
    result: response.error ? null : finalizationSchema.parse(response.data),
  }
}

export async function verifyAuthCodeAndIssueHandoff(
  supabase: ServiceRoleClient,
  input: {
    userId: string
    purpose: AuthVerificationPurpose
    code: string
    maxAttempts: number
    handoffTtlMs: number
  },
) {
  const lookup = await getLatestAuthVerificationCode(supabase, input)
  if (lookup.error) return { error: lookup.error, handoffToken: null }

  const candidate = lookup.candidate
  const candidateUsable = Boolean(
    candidate
      && candidate.used_at === null
      && Date.parse(candidate.expires_at) > Date.now()
      && candidate.attempts < input.maxAttempts,
  )
  const codeMatched = await verifyCode(
    input.code,
    candidateUsable ? candidate!.code_hash : DUMMY_AUTH_BCRYPT_HASH,
  )
  const matchedCurrentCandidate = candidateUsable && codeMatched
  const handoffToken = matchedCurrentCandidate ? generateHandoffToken() : null
  const handoffExpiresAt = matchedCurrentCandidate
    ? new Date(Date.now() + input.handoffTtlMs).toISOString()
    : null
  const finalization = await finalizeAuthVerificationAttempt(supabase, {
    userId: input.userId,
    purpose: input.purpose,
    candidateId: candidate?.id || NONEXISTENT_AUTH_CODE_ID,
    candidateGeneration: candidate?.generation || 0,
    codeMatched: matchedCurrentCandidate,
    handoffTokenHash: handoffToken ? hashHandoffToken(handoffToken) : null,
    handoffExpiresAt,
    maxAttempts: input.maxAttempts,
  })

  return {
    error: finalization.error,
    handoffToken: finalization.result?.ok ? handoffToken : null,
  }
}

export async function inspectLatestAuthHandoff(
  supabase: ServiceRoleClient,
  input: { purpose: AuthVerificationPurpose; handoffTokenHash: string },
) {
  const response = await supabase.rpc('inspect_latest_auth_handoff_v1', {
    p_purpose: input.purpose,
    p_handoff_token_hash: input.handoffTokenHash,
  })
  return {
    error: response.error,
    handoff: response.error || response.data === null ? null : handoffSchema.parse(response.data),
  }
}

export async function consumeSignupPasswordHandoff(
  supabase: ServiceRoleClient,
  input: {
    userId: string
    generation: number
    handoffTokenHash: string
    passwordHash: string
    expectedCredentialVersion: number
  },
) {
  const response = await supabase.rpc('consume_signup_password_handoff_v1', {
    p_user_id: input.userId,
    p_generation: input.generation,
    p_handoff_token_hash: input.handoffTokenHash,
    p_password_hash: input.passwordHash,
    p_expected_credential_version: input.expectedCredentialVersion,
  })
  return {
    error: response.error,
    credentialVersion: response.error || response.data === null
      ? null
      : generationSchema.parse(response.data),
  }
}

export async function consumeLatestPasswordReset(
  supabase: ServiceRoleClient,
  input: {
    userId: string
    generation: number
    handoffTokenHash: string
    passwordHash: string
  },
) {
  const response = await supabase.rpc('consume_latest_password_reset_and_revoke_sessions_v1', {
    p_user_id: input.userId,
    p_generation: input.generation,
    p_handoff_token_hash: input.handoffTokenHash,
    p_password_hash: input.passwordHash,
  })
  return {
    error: response.error,
    credentialVersion: response.error || response.data === null
      ? null
      : generationSchema.parse(response.data),
  }
}
