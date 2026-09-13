import { z } from 'zod'
import {
  palErasureReceiptSchema, parsePalErasureReceipt, requestPalProfileErasure,
  PalErasureError, type PalErasureReceipt,
} from '@/lib/server/pal-profile-erasure'
import { postBaraParticipantErasure, BaraAttendanceClientError } from '@/lib/server/bara-attendance-client'
import { invalidatePalReadTokenForMembership } from '@/lib/server/pal-read-token'
import { parseParticipantErasureReceipt, type ParticipantErasureReceipt } from '@/vendor/attendance-contract/participant-erasure'

const uuid = z.string().uuid().regex(/^[a-f0-9-]{36}$/)
const opaque = z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/)
export const studentProviderScopeSchema = z.object({
  operationId: uuid, teacherId: uuid, classroomId: uuid, studentId: uuid, generationId: uuid,
}).strict()
export type StudentProviderScope = z.infer<typeof studentProviderScopeSchema>
const bindingSchema = z.object({
  schema_version: z.literal(1), operation_id: uuid, generation_id: uuid,
  status: z.literal('provider_pending'), pal_origin: z.string().url(), pal_integration_id: uuid,
  pal_reference: z.string().regex(/^pika-membership-v1-[a-f0-9]{32}$/),
  bara_origin: z.string().url(), installation_ref: opaque, roster_ref: opaque,
  participant_ref: opaque, actor_principal_ref: opaque,
  pal_receipt: palErasureReceiptSchema.nullable(), bara_receipt: z.unknown(),
}).strict()
export type StudentProviderBinding = z.infer<typeof bindingSchema>

export class StudentProviderCleanupError extends Error {
  constructor(readonly code: 'disabled' | 'binding_invalid' | 'provider_unavailable' | 'persistence_unavailable',
    readonly retryable = false) {
    super('Student provider cleanup remains pending')
    this.name = 'StudentProviderCleanupError'
  }
}

function baraRequest(binding: StudentProviderBinding, action: 'begin' | 'tick' | 'status') {
  return { schema_version: 1 as const, message_type: 'participant.erase' as const, action,
    installation_ref: binding.installation_ref, roster_ref: binding.roster_ref,
    participant_ref: binding.participant_ref,
    operation_ref: `erase_participant_${binding.operation_id.replaceAll('-', '')}`,
    actor_principal_ref: binding.actor_principal_ref }
}
function validateBinding(raw: unknown, scope: StudentProviderScope): StudentProviderBinding {
  const parsed = bindingSchema.safeParse(raw)
  if (!parsed.success || parsed.data.operation_id !== scope.operationId
    || parsed.data.generation_id !== scope.generationId) throw new StudentProviderCleanupError('binding_invalid')
  const binding = parsed.data
  if (binding.pal_receipt && !parsePalErasureReceipt(binding.pal_receipt,
    { operation_id: binding.operation_id, learner_id: binding.pal_reference })) throw new StudentProviderCleanupError('binding_invalid')
  if (binding.bara_receipt !== null && !parseParticipantErasureReceipt(binding.bara_receipt, baraRequest(binding, 'status')))
    throw new StudentProviderCleanupError('binding_invalid')
  return binding
}
function sameBinding(before: StudentProviderBinding, after: StudentProviderBinding) {
  return Object.keys(before).filter(key => key !== 'pal_receipt' && key !== 'bara_receipt')
    .every(key => before[key as keyof StudentProviderBinding] === after[key as keyof StudentProviderBinding])
}
function status(binding: StudentProviderBinding) {
  return { operation_id: binding.operation_id, status: 'provider_pending' as const,
    pal: binding.pal_receipt?.status ?? 'not_started',
    bara: binding.bara_receipt === null ? 'not_started' : parseParticipantErasureReceipt(binding.bara_receipt, baraRequest(binding, 'status'))!.state,
    cleanup_completed: false as const }
}

/** One bounded provider request on the existing database-owned prerequisite. */
export function createStudentProviderCleanupCoordinator(dependencies: {
  reserve: (scope: StudentProviderScope) => Promise<unknown>
  read: (scope: StudentProviderScope) => Promise<unknown>
  authorize: (scope: StudentProviderScope) => Promise<unknown>
  record: (scope: StudentProviderScope, provider: 'pal' | 'bara', receipt: PalErasureReceipt | ParticipantErasureReceipt) => Promise<unknown>
  pal?: typeof requestPalProfileErasure
  bara?: typeof postBaraParticipantErasure
  invalidate?: typeof invalidatePalReadTokenForMembership
}) {
  const pal = dependencies.pal ?? requestPalProfileErasure
  const bara = dependencies.bara ?? postBaraParticipantErasure
  const invalidate = dependencies.invalidate ?? invalidatePalReadTokenForMembership
  function gate() {
    if (process.env.STUDENT_PROVIDER_CLEANUP_ENABLED !== 'true') throw new StudentProviderCleanupError('disabled')
  }
  async function load(read: typeof dependencies.read, scope: StudentProviderScope) {
    let raw: unknown
    try { raw = await read(scope) } catch (error) {
      if (error instanceof StudentProviderCleanupError) throw error
      throw new StudentProviderCleanupError('persistence_unavailable', true)
    }
    return validateBinding(raw, scope)
  }
  return {
    async reserve(input: unknown) {
      gate()
      const scope = studentProviderScopeSchema.parse(input)
      const binding = await load(dependencies.reserve, scope)
      invalidate(binding.pal_reference)
      return status(binding)
    },
    async read(input: unknown) {
      const scope = studentProviderScopeSchema.parse(input)
      return status(await load(dependencies.read, scope))
    },
    async advance(input: unknown, requestedProvider: 'pal' | 'bara') {
      gate()
      const scope = studentProviderScopeSchema.parse(input)
      const provider = z.enum(['pal', 'bara']).parse(requestedProvider)
      const binding = await load(dependencies.authorize, scope)
      invalidate(binding.pal_reference)
      let receipt: PalErasureReceipt | ParticipantErasureReceipt
      try {
        if (provider === 'pal') {
          if (binding.pal_receipt?.status === 'completed') return status(binding)
          const response = await pal('begin', { operation_id: binding.operation_id, learner_id: binding.pal_reference },
            { binding: { origin: binding.pal_origin, integrationId: binding.pal_integration_id } })
          const verified = parsePalErasureReceipt(response, { operation_id: binding.operation_id, learner_id: binding.pal_reference })
          if (!verified) throw new StudentProviderCleanupError('binding_invalid')
          receipt = verified
        } else {
          const saved = parseParticipantErasureReceipt(binding.bara_receipt, baraRequest(binding, 'status'))
          if (saved?.state === 'deleted') return status(binding)
          const request = baraRequest(binding, saved ? 'tick' : 'begin')
          const response = await bara(request, { expectedOrigin: binding.bara_origin })
          const verified = parseParticipantErasureReceipt(response, request)
          if (!verified) throw new StudentProviderCleanupError('binding_invalid')
          receipt = verified
        }
      } catch (error) {
        if (error instanceof StudentProviderCleanupError) throw error
        throw new StudentProviderCleanupError('provider_unavailable',
          (error instanceof PalErasureError || error instanceof BaraAttendanceClientError) && error.retryable)
      }
      const after = await load(current => dependencies.record(current, provider, receipt), scope)
      if (!sameBinding(binding, after)) throw new StudentProviderCleanupError('binding_invalid')
      const recorded = provider === 'pal' ? after.pal_receipt : after.bara_receipt
      if (!recorded || typeof recorded !== 'object'
        || !Object.entries(receipt).every(([key, value]) => (recorded as Record<string, unknown>)[key] === value))
        throw new StudentProviderCleanupError('binding_invalid')
      return status(after)
    },
  }
}
