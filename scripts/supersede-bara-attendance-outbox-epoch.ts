import { z } from 'zod'

import { getServiceRoleClient } from '@/lib/supabase'
import {
  attendanceEntitlementAuthorizationMatches,
  attendanceOutboxRecoveryAuthorizationBinding,
  exactAttendanceEntitlementTarget,
} from '@/lib/server/bara-attendance-entitlement-authorization'

const uuid = z.string().uuid()

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function repeatedArguments(name: string) {
  return process.argv.flatMap((value, index) =>
    value === `--${name}` && process.argv[index + 1]
      ? [process.argv[index + 1]]
      : [],
  )
}

async function main() {
  const execute = process.argv.includes('--execute')
  const input = z.object({
    operationId: uuid,
    teacherId: uuid,
    expectedEntitlementRevision: z.coerce.number().int().positive(),
    outboxIds: z.array(uuid).min(1).max(100)
      .refine((ids) => new Set(ids).size === ids.length, 'Outbox IDs must be unique'),
    actorRef: z.string().regex(/^[A-Za-z0-9._~:@-]{1,100}$/),
    reasonCode: z.string().regex(/^[a-z][a-z0-9._-]{0,99}$/),
  }).parse({
    operationId: argument('operation-id'),
    teacherId: argument('teacher-id'),
    expectedEntitlementRevision: argument('expected-entitlement-revision'),
    outboxIds: repeatedArguments('outbox-id'),
    actorRef: argument('actor-ref'),
    reasonCode: argument('reason-code'),
  })
  const outboxIds = [...input.outboxIds].sort()
  const targetOrigin = exactAttendanceEntitlementTarget(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  )
  const authorizationBinding = attendanceOutboxRecoveryAuthorizationBinding({
    ...input,
    outboxIds,
    targetOrigin,
  })
  const supabase = getServiceRoleClient() as any
  const [{ data: entitlement, error: entitlementError }, { data: rows, error: rowsError }] =
    await Promise.all([
      supabase.from('attendance_teacher_entitlements')
        .select('status,valid_from,valid_until,revision,source')
        .eq('teacher_id', input.teacherId)
        .maybeSingle(),
      supabase.from('attendance_integration_outbox')
        .select('id,classroom_id,message_type,status,entitlement_revision,lease_expires_at')
        .in('id', outboxIds)
        .order('id'),
    ])
  if (entitlementError || rowsError) {
    throw new Error('Attendance outbox recovery state could not be read')
  }
  if (!execute) {
    console.log(JSON.stringify({
      mode: 'dry_run',
      target_origin: targetOrigin,
      authorization_binding: authorizationBinding,
      expected_entitlement_revision: input.expectedEntitlementRevision,
      requested_count: outboxIds.length,
      entitlement: entitlement ?? null,
      rows: rows ?? [],
    }, null, 2))
    return
  }
  if (!attendanceEntitlementAuthorizationMatches(
    process.env.PIKA_ATTENDANCE_OUTBOX_RECOVERY_AUTHORIZATION,
    authorizationBinding,
  )) {
    throw new Error(
      'Set PIKA_ATTENDANCE_OUTBOX_RECOVERY_AUTHORIZATION to the exact dry-run binding for this one execution',
    )
  }
  const { data, error } = await supabase.rpc('supersede_attendance_outbox_epoch_v1', {
    p_operation_id: input.operationId,
    p_teacher_id: input.teacherId,
    p_expected_entitlement_revision: input.expectedEntitlementRevision,
    p_outbox_ids: outboxIds,
    p_actor_ref: input.actorRef,
    p_reason_code: input.reasonCode,
  })
  if (error) throw new Error('Attendance outbox recovery failed')
  const result = z.object({
    teacher_id: uuid,
    previous_entitlement_revision: z.number().int().positive(),
    new_entitlement_revision: z.number().int().positive(),
    superseded_count: z.number().int().positive().max(100),
    duplicate: z.boolean(),
  }).strict().parse(data)
  console.log(JSON.stringify({
    mode: 'executed',
    previous_entitlement_revision: result.previous_entitlement_revision,
    new_entitlement_revision: result.new_entitlement_revision,
    superseded_count: result.superseded_count,
    duplicate: result.duplicate,
  }, null, 2))
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
