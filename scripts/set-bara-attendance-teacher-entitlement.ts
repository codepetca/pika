import { z } from 'zod'

import { getServiceRoleClient } from '@/lib/supabase'

const uuid = z.string().uuid()
const isoTimestamp = z.string().datetime({ offset: true })

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const execute = process.argv.includes('--execute')
const input = z.object({
  operationId: uuid,
  teacherId: uuid,
  status: z.enum(['active', 'revoked']),
  validFrom: isoTimestamp,
  validUntil: z.union([isoTimestamp, z.literal('none')]),
  source: z.string().regex(/^[a-z][a-z0-9._-]{0,49}$/),
  actorRef: z.string().regex(/^[A-Za-z0-9._~:@-]{1,100}$/),
  reasonCode: z.string().regex(/^[a-z][a-z0-9._-]{0,99}$/),
  expectedRevision: z.coerce.number().int().nonnegative(),
}).parse({
  operationId: argument('operation-id'),
  teacherId: argument('teacher-id'),
  status: argument('status'),
  validFrom: argument('valid-from'),
  validUntil: argument('valid-until'),
  source: argument('source'),
  actorRef: argument('actor-ref'),
  reasonCode: argument('reason-code'),
  expectedRevision: argument('expected-revision'),
})

const supabase = getServiceRoleClient() as any
const { data: current, error: readError } = await supabase
  .from('attendance_teacher_entitlements')
  .select('status,valid_from,valid_until,revision,source')
  .eq('teacher_id', input.teacherId)
  .maybeSingle()
if (readError) throw new Error('Attendance entitlement state could not be read')

if (!execute) {
  console.log(JSON.stringify({
    mode: 'dry_run',
    current: current ?? null,
    proposed: {
      status: input.status,
      valid_from: input.validFrom,
      valid_until: input.validUntil === 'none' ? null : input.validUntil,
      source: input.source,
      expected_revision: input.expectedRevision,
    },
  }, null, 2))
} else {
  if (process.env.PIKA_ATTENDANCE_ENTITLEMENT_AUTHORIZATION !== input.operationId) {
    throw new Error(
      'Set PIKA_ATTENDANCE_ENTITLEMENT_AUTHORIZATION to the exact operation ID for this one execution',
    )
  }
  const { data, error } = await supabase.rpc('set_attendance_teacher_entitlement_v1', {
    p_operation_id: input.operationId,
    p_teacher_id: input.teacherId,
    p_status: input.status,
    p_valid_from: input.validFrom,
    p_valid_until: input.validUntil === 'none' ? null : input.validUntil,
    p_source: input.source,
    p_actor_ref: input.actorRef,
    p_reason_code: input.reasonCode,
    p_expected_revision: input.expectedRevision,
  })
  if (error) throw new Error('Attendance entitlement change failed')
  const result = z.object({
    teacher_id: uuid,
    status: z.enum(['active', 'revoked']),
    revision: z.number().int().positive(),
    duplicate: z.boolean(),
  }).strict().parse(data)
  console.log(JSON.stringify({
    mode: 'executed',
    status: result.status,
    revision: result.revision,
    duplicate: result.duplicate,
  }, null, 2))
}
