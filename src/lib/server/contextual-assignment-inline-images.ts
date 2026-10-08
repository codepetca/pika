import { z } from 'zod'

import { ApiError } from '@/lib/api-handler'
import type { AuthenticatedUser } from '@/types'
import { isClassroomExperienceAdmissionConfigured, resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'

const canonicalUuid = z.string().uuid().transform((value) => value.toLowerCase())
const imagePairsSchema = z.array(z.object({
  userId: canonicalUuid,
  classroomId: canonicalUuid,
}).strict()).max(100)

const successSchema = z.object({
  ok: z.literal(true),
  classroom_id: canonicalUuid,
  assignment_id: canonicalUuid,
  assignment_doc_id: canonicalUuid,
  managed_object_id: canonicalUuid.optional(),
}).strict()
const errorSchema = z.object({
  ok: z.literal(false),
  status: z.union([z.literal(403), z.literal(404), z.literal(409)]),
  error: z.string(),
}).strict()

export type ContextualAssignmentInlineImageClient = {
  rpc: (name: string, args: Record<string, string>) => PromiseLike<{
    data: unknown
    error: { code?: string; message?: string } | null
  }>
}

type InlineImageAccess =
  | { mode: 'legacy'; user: AuthenticatedUser; classroomId: string }
  | { mode: 'contextual'; user: AuthenticatedUser; classroomId: string }

function configuredImagePairs(): z.infer<typeof imagePairsSchema> | null {
  const raw = process.env.PIKA_CLASSROOM_ASSIGNMENT_IMAGE_ACCESS_PAIRS
  if (!raw || raw.length > 20_000) return null
  try {
    const parsed = imagePairsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Validate shared admission, then any existing image gate, before compatibility disclosure. */
export function assertContextualAssignmentInlineImageConfiguration(user?: AuthenticatedUser): void {
  if (isClassroomExperienceAdmissionConfigured()
    && resolveClassroomExperienceAdmission({ id: user?.id ?? '' }).status === 'admitted') return

  if (process.env.PIKA_CLASSROOM_ASSIGNMENT_IMAGE_ACCESS_ENABLED === 'true'
    && configuredImagePairs() === null) {
    throw new ApiError(503, 'Classroom assignment image configuration is unavailable')
  }
}

/**
 * Shared experience or existing exact-pair admission only. Callers authenticate and resolve a trusted
 * Assignment/Classroom binding before using this gate; it never accepts IDs
 * supplied by a browser as relationship evidence.
 */
export function authorizeContextualAssignmentInlineImageAccess(
  user: AuthenticatedUser,
  classroomId: string,
): InlineImageAccess {
  if (isClassroomExperienceAdmissionConfigured()
    && resolveClassroomExperienceAdmission(user).status === 'admitted') {
    const requestedId = canonicalUuid.safeParse(classroomId)
    if (!requestedId.success) throw new ApiError(400, 'Invalid classroom ID')
    return { mode: 'contextual', user, classroomId: requestedId.data }
  }

  if (process.env.PIKA_CLASSROOM_ASSIGNMENT_IMAGE_ACCESS_ENABLED !== 'true') {
    return { mode: 'legacy', user, classroomId }
  }

  assertContextualAssignmentInlineImageConfiguration(user)
  const pairs = configuredImagePairs()
  const identity = canonicalUuid.safeParse(user.id)
  const requestedClassroomId = canonicalUuid.safeParse(classroomId)
  if (pairs === null || !identity.success || !requestedClassroomId.success) {
    throw new ApiError(503, 'Classroom assignment image configuration is unavailable')
  }

  if (!pairs.some((pair) => (
    pair.userId === identity.data && pair.classroomId === requestedClassroomId.data
  ))) {
    return { mode: 'legacy', user, classroomId }
  }
  return { mode: 'contextual', user, classroomId: requestedClassroomId.data }
}

function parsedIds(input: { actorId: string; classroomId: string; assignmentDocId: string; managedObjectId?: string }) {
  const actorId = canonicalUuid.safeParse(input.actorId)
  const classroomId = canonicalUuid.safeParse(input.classroomId)
  const assignmentDocId = canonicalUuid.safeParse(input.assignmentDocId)
  const managedObjectId = input.managedObjectId === undefined
    ? undefined
    : canonicalUuid.safeParse(input.managedObjectId)
  if (!actorId.success || !classroomId.success || !assignmentDocId.success || (managedObjectId && !managedObjectId.success)) {
    throw new ApiError(400, 'Invalid assignment image request')
  }
  return {
    actorId: actorId.data,
    classroomId: classroomId.data,
    assignmentDocId: assignmentDocId.data,
    managedObjectId: managedObjectId?.data,
  }
}

function mapRpcError(error: { code?: string; message?: string }): never {
  if (error.code === 'P0002') throw new ApiError(404, 'Assignment document not found')
  if (error.code === '42501') throw new ApiError(403, 'Forbidden')
  if (error.code === '22023') throw new ApiError(400, 'Invalid assignment image request')
  if (error.code === '40001' || error.code === '55P03') {
    throw new ApiError(409, 'Assignment access changed. Refresh and try again.')
  }
  throw new ApiError(503, 'Unable to verify assignment image access')
}

function parseContext(data: unknown, ids: ReturnType<typeof parsedIds>, requiresObject: boolean) {
  const parsed = successSchema.safeParse(data)
  if (
    !parsed.success
    || parsed.data.classroom_id !== ids.classroomId
    || parsed.data.assignment_doc_id !== ids.assignmentDocId
    || (requiresObject && parsed.data.managed_object_id !== ids.managedObjectId)
  ) {
    throw new ApiError(503, 'Unable to verify assignment image access')
  }
  return {
    classroomId: parsed.data.classroom_id,
    assignmentId: parsed.data.assignment_id,
    assignmentDocId: parsed.data.assignment_doc_id,
    ...(requiresObject ? { managedObjectId: parsed.data.managed_object_id as string } : {}),
  }
}

export async function readContextualAssignmentInlineImage(input: {
  supabase: ContextualAssignmentInlineImageClient
  actorId: string
  classroomId: string
  assignmentDocId: string
  managedObjectId: string
}) {
  const ids = parsedIds(input)
  const { data, error } = await input.supabase.rpc('read_assignment_inline_image_for_context_v1', {
    p_actor_id: ids.actorId,
    p_expected_classroom_id: ids.classroomId,
    p_assignment_doc_id: ids.assignmentDocId,
    p_managed_object_id: ids.managedObjectId as string,
  })
  if (error) mapRpcError(error)
  const denied = errorSchema.safeParse(data)
  if (denied.success) return null
  return parseContext(data, ids, true)
}

export async function reserveContextualAssignmentInlineImage(input: {
  supabase: ContextualAssignmentInlineImageClient
  actorId: string
  classroomId: string
  assignmentDocId: string
  managedObjectId: string
  extension: string
  contentType: string
  byteSize: number
}) {
  const ids = parsedIds(input)
  if (!/^[a-z0-9]{1,10}$/.test(input.extension)
    || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(input.contentType)
    || !Number.isInteger(input.byteSize) || input.byteSize <= 0 || input.byteSize > 10 * 1024 * 1024) {
    throw new ApiError(400, 'Invalid assignment image request')
  }
  const { data, error } = await input.supabase.rpc('reserve_assignment_inline_image_for_member_v1', {
    p_actor_id: ids.actorId,
    p_expected_classroom_id: ids.classroomId,
    p_assignment_doc_id: ids.assignmentDocId,
    p_object_id: ids.managedObjectId as string,
    p_extension: input.extension,
    p_content_type: input.contentType,
    p_byte_size: String(input.byteSize),
  })
  if (error) mapRpcError(error)
  const denied = errorSchema.safeParse(data)
  if (denied.success) throw new ApiError(denied.data.status, denied.data.error)
  return parseContext(data, ids, true)
}

export async function finalizeContextualAssignmentInlineImage(input: {
  supabase: ContextualAssignmentInlineImageClient
  actorId: string
  classroomId: string
  assignmentDocId: string
  managedObjectId: string
}) {
  const ids = parsedIds(input)
  const { data, error } = await input.supabase.rpc('finalize_assignment_inline_image_for_member_v1', {
    p_actor_id: ids.actorId,
    p_expected_classroom_id: ids.classroomId,
    p_assignment_doc_id: ids.assignmentDocId,
    p_managed_object_id: ids.managedObjectId as string,
  })
  if (error) mapRpcError(error)
  const denied = errorSchema.safeParse(data)
  if (denied.success) throw new ApiError(denied.data.status, denied.data.error)
  return parseContext(data, ids, true)
}
