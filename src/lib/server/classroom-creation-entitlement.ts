import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getServiceRoleClient } from '@/lib/supabase'

export type ClassroomCreationDatabaseError = {
  code?: string | null
  message?: string | null
}

const canonicalUuidSchema = z.string().uuid().transform((value) => value.toLowerCase())

const classroomCreationSuccessSchema = z.object({
  ok: z.literal(true),
  status: z.literal(201),
  operation_id: canonicalUuidSchema,
  replayed: z.boolean(),
  classroom: z.object({ id: canonicalUuidSchema }).passthrough(),
}).strict()

const classroomCreationFailureSchema = z.discriminatedUnion('error_code', [
  z.object({
    ok: z.literal(false),
    status: z.literal(409),
    operation_id: canonicalUuidSchema,
    error_code: z.literal('classroom_creation_idempotency_conflict'),
    error: z.string(),
    retryable: z.literal(false),
  }).strict(),
  z.object({
    ok: z.literal(false),
    status: z.literal(409),
    operation_id: canonicalUuidSchema,
    error_code: z.literal('classroom_creation_result_unavailable'),
    error: z.string(),
    retryable: z.literal(false),
  }).strict(),
])

const classroomCreationResultSchema = z.union([
  classroomCreationSuccessSchema,
  classroomCreationFailureSchema,
])

export type ClassroomCreationAtomicResult = z.infer<typeof classroomCreationResultSchema>

export type ClassroomCreationAtomicOutcome =
  | { kind: 'result'; result: ClassroomCreationAtomicResult }
  | { kind: 'database_error'; error: ClassroomCreationDatabaseError }
  | { kind: 'contract_unavailable' }

type ClassroomCreationRpc = (
  functionName: 'create_classroom_atomic_v1',
  args: {
    p_operation_id: string
    p_subject_user_id: string
    p_request_sha256: string
    p_title: string
    p_class_code: string
    p_term_label: string | null
    p_theme_color: string
  },
) => PromiseLike<{ data: unknown; error: ClassroomCreationDatabaseError | null }>

export function resolveClassroomCreationOperationId(
  value: string | null | undefined,
): string {
  if (!value) return randomUUID()
  return canonicalUuidSchema.parse(value.trim())
}

export function hashClassroomCreationRequest(input: {
  title: string
  classCode?: string
  termLabel?: string
  themeColor?: string
}): string {
  return createHash('sha256').update(JSON.stringify({
    title: input.title,
    class_code: input.classCode ?? null,
    term_label: input.termLabel ?? null,
    theme_color: input.themeColor ?? null,
  })).digest('hex')
}

export async function createClassroomAtomic(args: {
  operationId: string
  teacherId: string
  request: {
    title: string
    classCode?: string
    termLabel?: string
    themeColor?: string
  }
  resolvedClassCode: string
  resolvedThemeColor: string
  supabase?: Pick<ReturnType<typeof getServiceRoleClient>, 'rpc'>
}): Promise<ClassroomCreationAtomicOutcome> {
  const operationId = canonicalUuidSchema.parse(args.operationId)
  const requestSha256 = hashClassroomCreationRequest(args.request)
  const supabase = args.supabase ?? getServiceRoleClient()
  // Migration 167 owns this service-only RPC. Keep the local signature explicit
  // so source checks remain useful before generated DB types are refreshed.
  const rpc = supabase.rpc as unknown as ClassroomCreationRpc
  const { data, error } = await rpc('create_classroom_atomic_v1', {
    p_operation_id: operationId,
    p_subject_user_id: args.teacherId,
    p_request_sha256: requestSha256,
    p_title: args.request.title,
    p_class_code: args.resolvedClassCode,
    p_term_label: args.request.termLabel ?? null,
    p_theme_color: args.resolvedThemeColor,
  })

  if (error) return { kind: 'database_error', error }

  const parsed = classroomCreationResultSchema.safeParse(data)
  if (!parsed.success || parsed.data.operation_id !== operationId) {
    return { kind: 'contract_unavailable' }
  }

  return { kind: 'result', result: parsed.data }
}

export type ClassroomCreationDenial = {
  status: 403 | 409 | 503
  errorCode:
    | 'classroom_creation_entitlement_disabled'
    | 'classroom_creation_entitlement_not_started'
    | 'classroom_creation_entitlement_expired'
    | 'classroom_creation_active_limit_reached'
    | 'classroom_creation_entitlement_unavailable'
  message: string
  retryable: boolean
}

/**
 * Maps only exact database authorization contracts. Do not expose arbitrary
 * database messages or infer an entitlement denial from a broad SQLSTATE.
 */
export function mapClassroomCreationDatabaseError(
  error: ClassroomCreationDatabaseError | null | undefined,
): ClassroomCreationDenial | null {
  if (!error) return null

  if (error.code === '42501') {
    if (error.message === 'classroom_creation_entitlement_disabled') {
      return {
        status: 403,
        errorCode: error.message,
        message: 'Classroom creation requires Access.',
        retryable: false,
      }
    }
    if (error.message === 'classroom_creation_entitlement_not_started') {
      return {
        status: 403,
        errorCode: error.message,
        message: 'Your classroom creation access is not active yet.',
        retryable: false,
      }
    }
    if (error.message === 'classroom_creation_entitlement_expired') {
      return {
        status: 403,
        errorCode: error.message,
        message: 'Your classroom creation access has expired.',
        retryable: false,
      }
    }
  }

  if (
    error.code === '23514'
    && error.message === 'classroom_creation_active_limit_reached'
  ) {
    return {
      status: 409,
      errorCode: error.message,
      message: 'Archive an active classroom before creating another.',
      retryable: false,
    }
  }

  if (
    error.code === '55000'
    && error.message === 'classroom_creation_entitlement_unavailable'
  ) {
    return {
      status: 503,
      errorCode: error.message,
      message: 'Classroom creation is temporarily unavailable. Please try again.',
      retryable: true,
    }
  }

  return null
}
