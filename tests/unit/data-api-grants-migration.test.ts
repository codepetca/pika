import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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

describe('disposable Data API grant fixture failures', () => {
  it.each(['initial schema cleanup', 'application schema reset'])('retains %s diagnostics and removes only its owned container', phase => {
    const directory = mkdtempSync(join(tmpdir(), 'pika-grants-harness-test-'))
    const statePath = join(directory, 'state.json')
    const id = 'a'.repeat(64)
    writeFileSync(join(directory, 'docker'), `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
const statePath = process.env.GRANTS_TEST_STATE
let state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {}
const save = () => fs.writeFileSync(statePath, JSON.stringify(state))
if (args[0] === 'inspect') {
  if (args[1] === 'supabase_db_pika') console.log(args.includes('{{.Image}}') ? 'test-image' : 'pika')
  else if (!state.owner) process.exit(1)
  else console.log(args.includes('--format') ? state.owner : '{}')
} else if (args[0] === 'run') {
  state.owner = args[args.indexOf('--label') + 1].split('=')[1]; save(); console.log('${id}')
} else if (args[0] === 'exec' && args.includes('pg_isready')) {
  state.tcpProbe = args.includes('127.0.0.1'); save()
} else if (args[0] === 'exec' && args.includes('psql') && !args.includes('-c')) {
  const sql = fs.readFileSync(0, 'utf8')
  const match = process.env.GRANTS_TEST_PHASE === 'initial schema cleanup' ? 'drop schema if exists public cascade;' : 'drop schema public cascade;'
  if (sql.includes(match)) { console.error('ERROR: fixture-reset sentinel'); process.exit(3) }
} else if (args[0] === 'rm') {
  state.removed = args.at(-1); save()
}
`, { mode: 0o700 })
    try {
      const result = spawnSync('bash', [resolve('scripts/check-data-api-grants-database.sh')], {
        encoding: 'utf8', timeout: 10_000,
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, TMPDIR: directory, DATA_API_GRANTS_SOURCE_CONTAINER: 'supabase_db_pika', GRANTS_TEST_STATE: statePath, GRANTS_TEST_PHASE: phase },
      })
      expect(result.status).toBe(3)
      expect(result.stderr).toContain(`Data API grants: ${phase} failed (exit 3)`)
      expect(result.stderr).toContain('ERROR: fixture-reset sentinel')
      expect(JSON.parse(readFileSync(statePath, 'utf8'))).toMatchObject({ tcpProbe: true, removed: id })
      expect(readdirSync(directory).sort()).toEqual(['docker', 'state.json'])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
