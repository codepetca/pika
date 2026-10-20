import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import {
  advanceClassroomPurge, getActiveClassroomPurgeStatus, getClassroomPurgeImpact,
  getClassroomPurgeStatus, startClassroomPurge,
} from '@/lib/server/classroom-purge'
import {
  advanceColdClassroomPurge, getActiveColdClassroomPurgeStatus, getColdClassroomPurgeImpact,
  getColdClassroomPurgeStatus, startColdClassroomPurge,
} from '@/lib/server/cold-classroom-purge'
import { classroomPurgeImpactSchema, classroomPurgeStatusSchema } from '@/lib/validations/classroom-purge'
import { coldClassroomPurgeImpactSchema } from '@/lib/validations/cold-classroom-purge'

const uuid = z.string().uuid().transform(value => value.toLowerCase())
const targetSchema = z.object({ actorId: uuid, classroomId: uuid, archiveId: uuid.optional() }).strict()
type Target = z.input<typeof targetSchema>
const unavailable = () => new ApiError(503, 'Permanent deletion outcome could not be verified; refresh to reconcile it')
const contextualStatusSchema = classroomPurgeStatusSchema.extend({
  error_code: z.string().max(120).regex(/^[a-zA-Z0-9_]+$/).nullable(),
})

// Only the admitted boundary sanitizes native failures. Uncertainty never starts a retry or cleanup.
async function checked<T>(work: () => Promise<T>): Promise<T> {
  try { return await work() } catch (error) {
    if (error instanceof ApiError && [400, 403, 404, 409].includes(error.statusCode)) {
      throw new ApiError(error.statusCode, error.statusCode === 404
        ? 'Permanent deletion not found' : 'Permanent deletion could not continue; review its impact and current state')
    }
    throw unavailable()
  }
}

function statusFor(value: unknown, target: ReturnType<typeof targetSchema.parse>, operationId?: string) {
  const parsed = contextualStatusSchema.safeParse(value)
  if (!parsed.success || parsed.data.classroom_id !== target.classroomId
    || (operationId && parsed.data.operation_id !== operationId)) throw unavailable()
  return parsed.data
}

/** Durable actor-bound audit remains readable after finalization removes the parent. */
export async function getContextualClassroomPurgeStatus(input: Target, requestedOperationId: string) {
  return checked(async () => {
    const target = targetSchema.parse(input)
    const operationId = uuid.parse(requestedOperationId)
    const value = target.archiveId
      ? await getColdClassroomPurgeStatus(target.actorId, target.classroomId, target.archiveId, operationId)
      : await getClassroomPurgeStatus(target.actorId, operationId)
    return statusFor(value, target, operationId)
  })
}

export async function getContextualClassroomPurgeImpact(input: Target) {
  return checked(async () => {
    const target = targetSchema.parse(input)
    const impact = target.archiveId
      ? coldClassroomPurgeImpactSchema.parse(await getColdClassroomPurgeImpact(target.actorId, target.classroomId, target.archiveId))
      : classroomPurgeImpactSchema.parse(await getClassroomPurgeImpact(target.actorId, target.classroomId))
    if (impact.classroom_id !== target.classroomId
      || (target.archiveId && (!('archive_id' in impact) || impact.archive_id !== target.archiveId))) throw unavailable()
    const active = target.archiveId
      ? await getActiveColdClassroomPurgeStatus(target.actorId, target.classroomId, target.archiveId)
      : await getActiveClassroomPurgeStatus(target.actorId, target.classroomId)
    const operation = active === null ? null : statusFor(active, target)
    // Rebind the exact durable operation, including cold archive and purge scope.
    if (operation) await getContextualClassroomPurgeStatus(target, operation.operation_id)
    return { impact, operation }
  })
}

type Start = Omit<Parameters<typeof startClassroomPurge>[0], 'teacherId' | 'classroomId' | 'expectedOperationalInventorySha256'> & {
  expectedOperationalInventorySha256?: string; expectedColdResourceInventorySha256?: string
}
export async function startContextualClassroomPurge(input: Target, start: Start) {
  return checked(async () => {
    const target = targetSchema.parse(input)
    const operationId = uuid.parse(start.operationId)
    const common = { ...start, operationId, teacherId: target.actorId, classroomId: target.classroomId }
    const value = target.archiveId
      ? await startColdClassroomPurge({ ...common, archiveId: target.archiveId, expectedColdResourceInventorySha256: start.expectedColdResourceInventorySha256! })
      : await startClassroomPurge({ ...common, expectedOperationalInventorySha256: start.expectedOperationalInventorySha256! })
    statusFor(value, target, operationId)
    return getContextualClassroomPurgeStatus(target, operationId)
  })
}

export async function advanceContextualClassroomPurge(input: Target, requestedOperationId: string) {
  return checked(async () => {
    const target = targetSchema.parse(input)
    const operationId = uuid.parse(requestedOperationId)
    const existing = await getContextualClassroomPurgeStatus(target, operationId)
    if (existing.status === 'completed') return { operation: existing, advanced: false }
    const result = z.object({ operation: classroomPurgeStatusSchema, advanced: z.boolean() }).strict().parse(target.archiveId
      ? await advanceColdClassroomPurge(target.actorId, operationId)
      : await advanceClassroomPurge(target.actorId, operationId))
    statusFor(result.operation, target, operationId)
    return { operation: await getContextualClassroomPurgeStatus(target, operationId), advanced: result.advanced }
  })
}
