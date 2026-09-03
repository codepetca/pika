import { createHmac } from 'node:crypto'
import { z } from 'zod'
import { ApiError } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { isPalEnabled } from '@/lib/server/pal-config'
import { buildClassroomJoinedEvent } from '@/lib/server/pal-events'

const successSchema = z.object({
  ok: z.literal(true),
  status: z.union([z.literal(200), z.literal(201)]),
  created: z.boolean(),
  already_enrolled: z.boolean(),
  classroom: z.object({
    id: z.string().uuid(),
    title: z.string(),
    term_label: z.string().nullable(),
  }),
  enrollment: z.object({
    id: z.string().uuid(),
    created_at: z.string(),
  }),
}).refine((result) => result.created !== result.already_enrolled)

const failureSchema = z.object({
  ok: z.literal(false),
  status: z.number().int().min(400).max(500),
  error_code: z.enum([
    'rate_limited',
    'actor_not_found',
    'classroom_not_found',
    'owner_self_join',
    'roster_ambiguous',
    'roster_binding_conflict',
    'enrollment_closed',
    'not_on_roster',
    'profile_required',
    'join_failed',
  ]),
  retry_after_seconds: z.number().int().positive().optional(),
  required_fields: z.array(z.enum(['firstName', 'lastName'])).optional(),
})

const resultSchema = z.discriminatedUnion('ok', [successSchema, failureSchema])

export type ContextualClassroomJoinResult = z.infer<typeof resultSchema>

export type ContextualClassroomJoinRpcClient = {
  rpc: (
    functionName: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: unknown }>
}

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
  const classCode = normalizeClassroomJoinCode(args.classCode)
  const keys = buildClassroomJoinRateLimitKeys(args.actorId, classCode)
  const palEvent = isPalEnabled()
    ? buildClassroomJoinedEvent({
        learnerId: args.actorId,
        classroomId: args.expectedClassroomId,
        occurredAt: args.occurredAt ?? new Date(),
      })
    : null
  // Migration 157 is intentionally not represented in generated types until
  // its separately authorized application and regeneration step.
  const supabase = args.supabase ?? (
    getServiceRoleClient() as unknown as ContextualClassroomJoinRpcClient
  )
  const { data, error } = await supabase.rpc('join_classroom_by_code_atomic_v1', {
    p_actor_id: args.actorId,
    p_expected_classroom_id: args.expectedClassroomId,
    p_class_code: classCode,
    p_actor_key_hash: keys.actorKeyHash,
    p_invitation_key_hash: keys.invitationKeyHash,
    p_first_name: args.firstName,
    p_last_name: args.lastName,
    p_student_number: args.studentNumber,
    p_pal_event: palEvent,
  })

  const parsed = resultSchema.safeParse(data)
  if (error || !parsed.success) {
    throw new ApiError(503, 'Classroom enrollment is temporarily unavailable')
  }
  return parsed.data
}
