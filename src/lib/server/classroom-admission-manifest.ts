import { createHash } from 'node:crypto'
import { z } from 'zod'

const uuid = z.string().uuid().transform((value) => value.toLowerCase())
const requestSchema = z.object({
  operationId: uuid,
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1),
  kind: z.enum(['bootstrap', 'operator', 'growth_on', 'growth_off']),
  userIds: z.array(uuid).max(5000),
  excludedUserIds: z.array(uuid).max(5000),
  approvalRef: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/),
}).strict().superRefine((request, context) => {
  const users = new Set(request.userIds)
  const exclusions = new Set(request.excludedUserIds)
  if (users.size !== request.userIds.length || exclusions.size !== request.excludedUserIds.length
    || request.userIds.some((id) => exclusions.has(id))
    || request.userIds.length + request.excludedUserIds.length > 5000
    || (request.kind === 'bootstrap' && request.userIds.length !== 70)
    || (request.kind === 'operator' && (request.userIds.length === 0 || request.excludedUserIds.length !== 0))
    || (['growth_on', 'growth_off'].includes(request.kind)
      && (request.userIds.length !== 0 || request.excludedUserIds.length !== 0))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid exact admission manifest' })
  }
})

export type ClassroomAdmissionManifestInput = z.input<typeof requestSchema>

/** Offline proposal builder only. It has no database, configuration or provider effects. */
export function prepareClassroomAdmissionManifest(input: ClassroomAdmissionManifestInput) {
  const request = requestSchema.parse(input)
  const userIds = [...request.userIds].sort()
  const excludedUserIds = [...request.excludedUserIds].sort()
  const canonical = `classroom-admission-v2\n${request.kind}\n${userIds.join('\n')}\n--excluded--\n${excludedUserIds.join('\n')}`
  return {
    p_operation_id: request.operationId,
    p_expected_revision: request.expectedRevision,
    p_kind: request.kind,
    p_user_ids: userIds,
    p_excluded_user_ids: excludedUserIds,
    p_manifest_sha256: createHash('sha256').update(canonical, 'utf8').digest('hex'),
    p_approval_ref: request.approvalRef,
  }
}
