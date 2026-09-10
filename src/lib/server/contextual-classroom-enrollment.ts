import { createHmac } from 'node:crypto'
import { z } from 'zod'
import { ApiError } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { isPalEnabled } from '@/lib/server/pal-config'
import { buildClassroomJoinedEvent } from '@/lib/server/pal-events'

const canonicalUuidSchema = z.string().uuid().transform((value) => value.toLowerCase())

const classroomSchema = z
  .object({
    id: canonicalUuidSchema,
    title: z.string(),
    term_label: z.string().nullable(),
  })
  .strict()

const enrollmentSchema = z
  .object({
    id: canonicalUuidSchema,
    created_at: z.string(),
  })
  .strict()

const createdSuccessSchema = z
  .object({
    ok: z.literal(true),
    status: z.literal(201),
    created: z.literal(true),
    already_enrolled: z.literal(false),
    classroom: classroomSchema,
    enrollment: enrollmentSchema,
  })
  .strict()

const existingSuccessSchema = z
  .object({
    ok: z.literal(true),
    status: z.literal(200),
    created: z.literal(false),
    already_enrolled: z.literal(true),
    classroom: classroomSchema,
    enrollment: enrollmentSchema,
  })
  .strict()

const rateLimitedFailureSchema = z
  .object({
    ok: z.literal(false),
    status: z.literal(429),
    error_code: z.literal('rate_limited'),
    retry_after_seconds: z.number().int().positive(),
  })
  .strict()

const failureSchema = z.discriminatedUnion('error_code', [
  rateLimitedFailureSchema,
  z
    .object({
      ok: z.literal(false),
      status: z.literal(404),
      error_code: z.literal('actor_not_found'),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      status: z.literal(404),
      error_code: z.literal('classroom_not_found'),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      status: z.literal(403),
      error_code: z.literal('owner_self_join'),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      status: z.literal(409),
      error_code: z.literal('roster_ambiguous'),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      status: z.literal(409),
      error_code: z.literal('roster_binding_conflict'),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      status: z.literal(403),
      error_code: z.literal('enrollment_closed'),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      status: z.literal(403),
      error_code: z.literal('not_on_roster'),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      status: z.literal(400),
      error_code: z.literal('profile_required'),
      required_fields: z.tuple([z.literal('firstName'), z.literal('lastName')]),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      status: z.literal(500),
      error_code: z.literal('join_failed'),
    })
    .strict(),
])

const resultSchema = z.union([createdSuccessSchema, existingSuccessSchema, failureSchema])
const guessResultSchema = z.union([
  z.object({ ok: z.literal(true) }).strict(),
  rateLimitedFailureSchema,
])

export type ContextualClassroomJoinResult = z.infer<typeof resultSchema>
export type ContextualClassroomJoinGuessResult = z.infer<typeof guessResultSchema>

export type ContextualClassroomJoinRpcClient = Pick<
  ReturnType<typeof getServiceRoleClient>,
  'rpc'
>

function getJoinRateLimitSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters')
  }
  return secret
}

function hmacJoinKey(value: string): string {
  return createHmac('sha256', getJoinRateLimitSecret()).update(value, 'utf8').digest('hex')
}

export function normalizeClassroomJoinCode(classCode: string): string {
  return classCode.trim().toUpperCase()
}

export function escapePostgrestLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

export function buildClassroomJoinRateLimitKeys(actorId: string, classCode: string): {
  actorKeyHash: string
  invitationKeyHash: string
} {
  const normalizedActorId = actorId.trim().toLowerCase()
  const normalizedCode = normalizeClassroomJoinCode(classCode)
  return {
    actorKeyHash: hmacJoinKey(`classroom_join_actor\0${normalizedActorId}`),
    invitationKeyHash: hmacJoinKey(
      `classroom_join_invitation\0${normalizedActorId}\0${normalizedCode}`
    ),
  }
}

export async function consumeClassroomJoinGuess(args: {
  actorId: string
  classCode: string
  supabase?: ContextualClassroomJoinRpcClient
}): Promise<ContextualClassroomJoinGuessResult> {
  const keys = buildClassroomJoinRateLimitKeys(args.actorId, args.classCode)
  const supabase = args.supabase ?? getServiceRoleClient()
  const { data, error } = await supabase.rpc('consume_classroom_join_guess_v1', {
    p_actor_key_hash: keys.actorKeyHash,
    p_invitation_key_hash: keys.invitationKeyHash,
  })
  const parsed = guessResultSchema.safeParse(data)
  if (error || !parsed.success) {
    throw new ApiError(503, 'Classroom enrollment is temporarily unavailable')
  }
  return parsed.data
}

export async function joinClassroomByCodeAtomic(args: {
  actorId: string
  expectedClassroomId: string
  classCode: string
  firstName: string | null
  lastName: string | null
  studentNumber: string | null
  occurredAt?: Date
  supabase?: ContextualClassroomJoinRpcClient
}): Promise<ContextualClassroomJoinResult> {
  const expectedClassroomIdResult = canonicalUuidSchema.safeParse(args.expectedClassroomId)
  if (!expectedClassroomIdResult.success) {
    throw new ApiError(503, 'Classroom enrollment is temporarily unavailable')
  }
  const expectedClassroomId = expectedClassroomIdResult.data
  const classCode = normalizeClassroomJoinCode(args.classCode)
  const keys = buildClassroomJoinRateLimitKeys(args.actorId, classCode)
  const palEvent = isPalEnabled()
    ? buildClassroomJoinedEvent({
        learnerId: args.actorId,
        classroomId: expectedClassroomId,
        occurredAt: args.occurredAt ?? new Date(),
      })
    : null
  const supabase = args.supabase ?? getServiceRoleClient()
  const { data, error } = await supabase.rpc('join_classroom_by_code_atomic_v1', {
    p_actor_id: args.actorId,
    p_expected_classroom_id: expectedClassroomId,
    p_class_code: classCode,
    p_actor_key_hash: keys.actorKeyHash,
    p_invitation_key_hash: keys.invitationKeyHash,
    p_first_name: args.firstName ?? undefined,
    p_last_name: args.lastName ?? undefined,
    p_student_number: args.studentNumber ?? undefined,
    p_pal_event: palEvent,
  })

  const parsed = resultSchema.safeParse(data)
  if (
    error ||
    !parsed.success ||
    (parsed.data.ok && parsed.data.classroom.id !== expectedClassroomId)
  ) {
    throw new ApiError(503, 'Classroom enrollment is temporarily unavailable')
  }
  return parsed.data
}
