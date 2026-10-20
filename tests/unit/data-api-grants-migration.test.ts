import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/281_explicit_data_api_grants.sql'), 'utf8')
const sql = migration.replace(/--[^\n]*/g, '')
const grants = [...sql.matchAll(/grant\s+([a-z,\s]+?)\s+on\s+(table|sequence)\s+([a-z_]+\.[a-z_]+)\s+to\s+([a-z_]+)\s*;/gi)]
const contract = new Map(grants.map(([, privileges, , object]) => [object, privileges.split(',').map(p => p.trim().toUpperCase()).sort()]))

describe('explicit Data API relation grants', () => {
  it('grants only individually named objects to the server role', () => {
    expect(grants.length).toBeGreaterThan(100)
    expect(grants.every(([, , , , role]) => role === 'service_role')).toBe(true)
    expect(sql).not.toMatch(/grant\s+all|grant[^;]+on\s+all|grant[^;]+to\s+(public|anon|authenticated)\b/i)
    expect(sql).not.toMatch(/\b(?:grant|revoke|alter)\b[^;]*\bfunctions?\b/i)
  })

  it('retains sensitive RPC-only relation boundaries', () => {
    for (const object of [
      'public.verification_codes', 'public.auth_rate_limits', 'public.auth_global_rate_limits',
      'public.classroom_join_rate_limits', 'public.course_guide_import_rate_limits',
      'public.course_blueprint_draft_admissions', 'public.course_blueprint_purge_fences',
      'public.managed_storage_writer_revision_seq', 'private.stripe_billing_settings',
      'private.removed_student_cleanup_jobs', 'private.pal_membership_generations',
    ]) expect(contract.has(object), object).toBe(false)

    expect(contract.get('public.auth_sessions')).toEqual(['DELETE', 'SELECT'])
    expect(contract.get('public.account_plans')).toEqual(['SELECT'])
    expect(contract.get('public.billing_upgrade_receipts')).toEqual(['SELECT'])
    expect(contract.get('public.attendance_override_requests')).toEqual(['INSERT', 'SELECT'])
    expect(contract.get('public.attendance_integration_outbox')).toEqual(['INSERT', 'SELECT', 'UPDATE'])
    expect(contract.get('private.test_attempt_draft_revision_seq')).toEqual(['USAGE'])
    expect(contract.get('public.stripe_checkout_audit_id_seq')).toEqual(['SELECT', 'UPDATE', 'USAGE'])
  })

  it('fails closed on global defaults that schema-local revocation cannot remove', () => {
    expect(sql).toContain('d.defaclnamespace = 0')
    expect(sql).toContain("d.defaclobjtype in ('r', 'S')")
    expect(sql.indexOf("raise exception 'Global relation default grants")).toBeLessThan(sql.indexOf('alter default privileges'))
    expect(sql).toMatch(/for role postgres in schema public\s+revoke all on tables from public, anon, authenticated, service_role/i)
    expect(sql).toMatch(/for role postgres in schema public\s+revoke all on sequences from public, anon, authenticated, service_role/i)
  })
})
