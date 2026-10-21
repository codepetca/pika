import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PAL_OWNER_QUEUE_STOP_REVIEWED_MIGRATION, validatePalOwnerQueueStopReviewedMigration } from '../../scripts/pal-owner-queue-stop-reviewed-migration'

const sql = readFileSync('supabase/migrations/287_pal_owner_queue_stop.sql', 'utf8')
const fixture = readFileSync('scripts/contextual-pal-classroom-db-contracts.sql', 'utf8')
const digest = (source: string) => createHash('sha256').update(source).digest('hex')
const candidate = () => ({ name: PAL_OWNER_QUEUE_STOP_REVIEWED_MIGRATION.name, sql, sha256: digest(sql) })

describe('Pal owner queue stop287 source contract (no database execution)', () => {
  it('seals exactly the current migration bytes', () => {
    expect(() => validatePalOwnerQueueStopReviewedMigration(candidate())).not.toThrow()
  })
  it.each(['name', 'digest', 'bytes', 'self-hashed-bytes'])('rejects changed %s', defect => {
    const changed = candidate()
    if (defect === 'name') changed.name = '288_unknown.sql'
    if (defect === 'digest') changed.sha256 = 'f'.repeat(64)
    if (defect === 'bytes' || defect === 'self-hashed-bytes') changed.sql += '\n'
    if (defect === 'self-hashed-bytes') changed.sha256 = digest(changed.sql)
    expect(() => validatePalOwnerQueueStopReviewedMigration(changed)).toThrow()
  })
  it('keeps identity evidence private and bounded without recursive contextual resolution', () => {
    expect(sql).toContain('private.pal_membership_evidence_v1')
    expect(sql).toContain('security invoker')
    expect(sql.match(/set lock_timeout='1s' set statement_timeout='5s'/g)).toHaveLength(5)
    expect(sql).toContain('for update nowait')
    expect(sql).toContain('for share nowait')
    expect(sql).toContain('from public,anon,authenticated,service_role;')
    expect(sql).not.toContain('resolve_pal_classroom_context')
    expect(sql).not.toMatch(/create\s+table|delete\s+from/i)
    expect(sql.match(/^alter function .* owner to postgres;$/gm)).toHaveLength(5)
  })
  it('returns owner only after exact generation, provenance, payload and live processing lease proof', () => {
    const delivery = sql.slice(sql.indexOf('create or replace function public.authorize_pal_membership_delivery'))
    const result = delivery.indexOf("return jsonb_build_object('status',case when exists")
    expect(result).toBeGreaterThan(-1)
    for (const gate of ["private.pal_classroom_signals_enabled()", "v_binding.generation_id::text", "event.student_id=v_binding.student_id",
      "event.source_kind='membership_v1'", "event.source_id=v_binding.generation_id::text", "event.status='processing'",
      'event.lease_token=p_lease_token', 'event.lease_expires_at>now()', "event.payload->>'learner_id'=v_binding.learner_id",
      "event.payload->>'schema_version'='1'", "event.payload->>'idempotency_key'=event.idempotency_key"]) {
      expect(delivery.indexOf(gate), gate).toBeGreaterThan(-1)
      expect(delivery.indexOf(gate), gate).toBeLessThan(result)
    }
    expect(delivery.slice(result, delivery.indexOf('end;', result))).not.toContain('learner_id')
    expect(sql).toContain("case when v_evidence->>'status'='disabled' then 'disabled' else 'forbidden' end")
  })
  it('durably stops only unsettled owner-bound facts with fail-fast row/advisory locking', () => {
    const stop = sql.slice(sql.indexOf('create function private.stop_pal_delivery_for_owner_v1'), sql.indexOf('create function private.stop_pal_delivery_on_owner_transition_v1'))
    expect(stop.indexOf('try_lock_classroom_membership_change')).toBeLessThan(stop.indexOf('for update of event nowait'))
    expect(stop.indexOf('for update of event nowait')).toBeLessThan(stop.indexOf('update private.pal_membership_outbox'))
    expect(stop).toContain("event.status in ('pending','processing')")
    expect(stop).toContain("and event.status='pending'")
    expect(stop).not.toContain("set status='processing'")
    expect(sql).toContain('when (old.teacher_id is distinct from new.teacher_id)')
    const backfill = sql.slice(sql.indexOf('do $$'), sql.indexOf('-- Shared evidence stays private'))
    expect(backfill).toContain('where exists(select 1 from private.pal_membership_outbox')
    expect(backfill).toContain('binding.student_id=classroom.teacher_id')
    expect(backfill).toContain("event.status in ('pending','processing')")
    expect(backfill).toContain('order by classroom.id for update of classroom nowait')
    expect(backfill).not.toContain('enabled')
    expect(sql).toContain('on private.pal_membership_outbox(classroom_id,student_id,outbox_id)')
  })
  it('authors real rollback histories and metadata checks while retaining pre287 contracts', () => {
    expect(fixture).toContain("to_regprocedure('private.pal_membership_evidence_v1(uuid,uuid)') is null then return")
    for (const evidence of ["array['student','teacher']", 'has_function_privilege', 'aclexplode', 'v_proc.proconfig',
      "'pending287'", "'processing287'", "'delivered287'", "'other287'", 'private.enqueue_membership_pal_fact',
      "'{\"status\":\"owner\"}'::jsonb", "'membership_owner'", 'v_delivered_before', 'v_generation', 'lease_expires_at=now()-']) {
      expect(fixture).toContain(evidence)
    }
  })
})
