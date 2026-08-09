import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/121_managed_deletion_health_monitoring.sql',
), 'utf8')

const functionBody = sql.match(
  /create or replace function public\.get_managed_deletion_health_snapshot[\s\S]*?as \$health\$([\s\S]*?)\$health\$/i,
)?.[1] ?? ''

const deepFunctionBody = sql.match(
  /create or replace function public\.get_managed_deletion_deep_health_snapshot[\s\S]*?as \$deep_health\$([\s\S]*?)\$deep_health\$/i,
)?.[1] ?? ''

describe('managed deletion health monitoring migration', () => {
  it('adds a service-role-only aggregate health snapshot', () => {
    expect(functionBody).not.toBe('')
    expect(sql).toContain('returns jsonb')
    expect(sql).toContain('security definer')
    expect(sql).toContain('set search_path = public, storage')
    expect(sql).toContain(
      'revoke all on function public.get_managed_deletion_health_snapshot(integer)',
    )
    expect(sql).toContain(
      'grant execute on function public.get_managed_deletion_health_snapshot(integer) to service_role',
    )
  })

  it('is read-only and returns counts rather than object identities', () => {
    expect(functionBody).not.toMatch(/\b(insert|update|delete|truncate)\s+(into|public\.|storage\.)/i)
    expect(functionBody).not.toContain("'storage_path'")
    expect(functionBody).not.toContain("'classroom_id'")
    expect(functionBody).not.toContain("'teacher_id'")
    expect(functionBody).toContain("'critical_count'")
    expect(functionBody).toContain("'warning_count'")
  })

  it('covers both purge ledgers, fences, leases, and exact-object reappearance', () => {
    for (const table of [
      'classroom_purge_operations',
      'classroom_purge_objects',
      'classroom_purge_fences',
      'course_blueprint_purge_operations',
      'course_blueprint_purge_objects',
      'course_blueprint_purge_fences',
    ]) {
      expect(functionBody).toContain(`public.${table}`)
    }
    expect(functionBody).toContain("status = 'processing'")
    expect(functionBody).toContain('lease_expires_at <= v_generated_at')
    expect(functionBody).toContain('public.managed_storage_identity_sha256')
    expect(functionBody).toContain('storage.objects')
  })

  it('covers live managed-storage ownership and embedded-reference drift', () => {
    expect(functionBody).toContain('public.managed_storage_object_is_referenced')
    expect(functionBody).toContain('public.managed_storage_json_references')
    expect(functionBody).toContain('raw_references_missing_identity')
    expect(functionBody).not.toContain('public.managed_storage_payload_raw_references')
    expect(functionBody).toContain('expired_provisional_owners')
    expect(functionBody).toContain('stale_cleanup_pending')
  })

  it('keeps recursive payload reconciliation in a separate unscheduled diagnostic', () => {
    expect(deepFunctionBody).not.toBe('')
    expect(deepFunctionBody).toContain('public.managed_storage_payload_raw_references')
    expect(deepFunctionBody).toContain('embedded_hosts_missing_registry')
    expect(deepFunctionBody).toContain('embedded_payload_identity_mismatches')
    expect(deepFunctionBody).toContain('embedded_evidence_mismatches')
    expect(deepFunctionBody).toContain('with registered_hosts as')
    expect(deepFunctionBody).toContain('from public.managed_storage_json_references reference')
    expect(sql).toContain(
      'grant execute on function public.get_managed_deletion_deep_health_snapshot()\n  to service_role',
    )
  })
})
