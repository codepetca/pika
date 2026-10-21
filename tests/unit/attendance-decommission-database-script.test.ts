import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const script = resolve(process.cwd(), 'scripts/check-attendance-decommission-database.sh')
const compatibility = readFileSync(resolve(process.cwd(),
  'supabase/migrations/281_attendance_decommission_retained_generations.sql'), 'utf8')
const grep = execFileSync('/bin/sh', ['-c', 'command -v grep'], { encoding: 'utf8' }).trim()
let fixtureDirectory: string

beforeEach(() => {
  fixtureDirectory = mkdtempSync(join(tmpdir(), 'pika-decommission-script-'))
  // Deliberately no rg or real Docker on PATH. No SQL reaches a database.
  symlinkSync(grep, join(fixtureDirectory, 'grep'))
  writeFileSync(join(fixtureDirectory, 'docker'), `#!/bin/bash
set -eu
case "$1" in
  inspect) printf '%s\\n' "\${FIXTURE_CLONE_INSPECTION:-$FIXTURE_PROJECT_LABEL}" ;;
  port) printf '%s\\n' "$FIXTURE_DB_BINDING" ;;
  exec) printf '%s\\n' "fixture-database-exec:$*" ;;
  *) exit 99 ;;
esac
`, { mode: 0o755 })
})

afterEach(() => {
  rmSync(fixtureDirectory, { recursive: true, force: true })
})

function runFixture(project: string, binding: string, args: string[] = [], cloneInspection = '') {
  return spawnSync('/bin/bash', [script, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: fixtureDirectory,
      BASH_ENV: '',
      FIXTURE_PROJECT_LABEL: project,
      FIXTURE_DB_BINDING: binding,
      FIXTURE_CLONE_INSPECTION: cloneInspection,
    },
  })
}

describe('attendance decommission database harness portability', () => {
  it('expects the exact installed tombstone guard and verifies failed reuse leaves no state', () => {
    const source = readFileSync(script, 'utf8')
    expect(source).toContain("to_regprocedure('private.attendance_pointer_mutation_allowed(jsonb,jsonb)')")
    expect(source).not.toContain("to_regprocedure('private.attendance_participant_generation_closed(text)')")
    expect(source).toContain("when sqlstate '55000' then")
    expect(source).toContain("if sqlerrm is distinct from v_reuse_error then raise;end if;")
    expect(source).toContain("then 'attendance_membership_generation_closed' else 'attendance_participant_association_conflict' end")
    expect(source).toContain('Closed reference reuse persisted a mapping or changed its tombstone')
    expect(source).toContain('v_tombstone is distinct from (select to_jsonb(association)')
  })

  it('allows only an explicitly owned immutable offline clone', () => {
    const id = 'a'.repeat(64)
    const result = runFixture('', '', ['--container-id', id, '--owner', '123:proof'],
      `${id}|123:proof|false|none|0||true`)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.match(/fixture-database-exec/g)).toHaveLength(2)
    expect(result.stdout).toContain(`exec -i ${id}`)
    const source = readFileSync(script, 'utf8')
    for (const guard of ['pika.attendance-membership.owner', '.HostConfig.NetworkMode',
      '.HostConfig.PortBindings', '.NetworkSettings.Ports', '.State.Running']) expect(source).toContain(guard)
  })

  it.each([
    'wrong|123:proof|false|none|0||true',
    `${'a'.repeat(64)}|456:other|false|none|0||true`,
    `${'a'.repeat(64)}|123:proof|true|none|0||true`,
    `${'a'.repeat(64)}|123:proof|false|bridge|0||true`,
    `${'a'.repeat(64)}|123:proof|false|none|1||true`,
    `${'a'.repeat(64)}|123:proof|false|none|0|bound|true`,
    `${'a'.repeat(64)}|123:proof|false|none|0||false`,
  ])('rejects a mismatched clone inspection before SQL: %s', inspection => {
    const result = runFixture('', '', ['--container-id', 'a'.repeat(64), '--owner', '123:proof'], inspection)
    expect(result.status).toBe(2)
    expect(result.stdout).not.toContain('fixture-database-exec')
  })

  it.each([
    ['--container-id', 'supabase_db_pika', '--owner', '123:proof'],
    ['--container-id', 'a'.repeat(64), '--owner', ''],
    ['--container-id', 'a'.repeat(64)],
    ['--unexpected'],
  ].map(args => [args]))('rejects malformed clone arguments %j', args => {
    const result = runFixture('pika', '0.0.0.0:54322', args)
    expect(result.status).toBe(2)
    expect(result.stdout).not.toContain('fixture-database-exec')
  })

  it('scrubs every captured legacy reference atomically at the existing participant phase', () => {
    const source = readFileSync(script, 'utf8')
    for (const assertion of [
      "version = '283'",
      'private.capture_attendance_participant_association(',
      'Historical association fixture did not retain all references',
      'Participant phase failure changed association evidence',
      'Authorized participant deletion did not scrub every scope association',
      'Other classroom association evidence changed',
      'Closed association reference was reusable',
      'Forged participant capability changed association evidence',
    ]) expect(source).toContain(assertion)
    expect(source).toContain('create trigger decommission_participant_failure after delete on public.attendance_participant_mappings')
    expect(source).not.toMatch(/disable trigger|session_replication_role/i)
  })

  it('tests incomplete student purge separately from linked attendance guards', () => {
    const source = readFileSync(script, 'utf8')
    expect(source).toContain('Unlinked purge conflict fixture gained attendance')
    expect(source).toContain("'Unlinked purge conflict', 'D15303'")
    const reservation = source.slice(source.indexOf('-- Existing independently reserved purge work'),
      source.indexOf("delete from public.student_purge_operations where id='d1530000-0000-4000-8000-000000000041'"))
    expect(reservation).toContain('public.attendance_student_has_state_v1(')
    expect(reservation).toContain("'d1530000-0000-4000-8000-000000000012'")
    expect(reservation).not.toContain("'d1530000-0000-4000-8000-000000000010'")
    expect(source).not.toMatch(/disable trigger|session_replication_role/)
  })
  it('keeps final Classroom purge independently gated and preserves saved replay evidence', () => {
    const source = readFileSync(script, 'utf8')
    expect(source).toContain('Fresh attendance-complete Classroom purge did not begin without objects')
    expect(source).toContain('Attendance-complete Classroom purge did not finalize')
    expect(source).toContain('Final Classroom purge changed saved fence, other attendance, or private replay history')
    expect(source).toContain('public.get_hot_archived_classroom_purge_inventory(')
    expect(source).toContain('public.finalize_hot_archived_classroom_purge(')
    expect(source).toContain('public.refresh_managed_storage_readiness()')
    expect(source).toContain('public.activate_managed_storage_enforcement(')
    expect(source).not.toContain("update public.managed_storage_settings set mode='enforced'")
    expect(source.match(/select kind,evidence from replay_before except/g)).toHaveLength(2)
    expect(source).not.toContain('select kind,row from replay_before')
  })
  it('keeps deletion authority private and separate from individual student cleanup', () => {
    expect(compatibility).toContain('capability.transaction_id=txid_current()')
    expect(compatibility).toContain("operation.state='remote_deleted'")
    expect(compatibility).toContain('operation.phase=capability.phase')
    expect(compatibility).toContain('capability.table_name=p_table')
    expect(compatibility).not.toMatch(/create or replace function private\.removed_academic_delete_allowed/)
    expect(compatibility).not.toMatch(/(?:update|delete from) private\.(?:attendance_membership_generations|pal_membership_generations|removed_student_cleanup_jobs)/i)
    expect(compatibility).not.toContain('set_config(')
    expect(compatibility).toContain("and status in ('queued','processing','retry_wait','quarantined')")
  })
  it('requires retained-generation, bounded-delete, failure and pending-job native regressions', () => {
    const source = readFileSync(script, 'utf8')
    for (const assertion of [
      'Private replay evidence changed',
      'Tick exceeded 500 rows',
      'Failed tick changed durable state',
      'Pending cleanup job created destructive intent',
      'Forged delete capability accepted',
      'attendance_membership_generation_immutable',
      'generate_series(1,501)',
    ]) expect(source).toContain(assertion)
  })
  it('runs separate rollback-only matrices for both current owner labels', () => {
    const result = runFixture('pika', '0.0.0.0:54322')
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.match(/fixture-database-exec/g)).toHaveLength(2)
    expect(result.stdout).toContain('fixture_owner_role=teacher')
    expect(result.stdout).toContain('fixture_owner_role=student')
    const source = readFileSync(script, 'utf8')
    expect(source.includes('for fixture_owner_role in teacher student; do')).toBe(true)
    expect(source.includes("update public.users set role = :'fixture_owner_role'\n where id = 'd1530000-0000-4000-8000-000000000001';")).toBe(true)
    expect(source.includes('rollback;\nSQL\ndone')).toBe(true)
  })
  it.each(['0.0.0.0:54322', '[::]:54322', '0.0.0.0:54322\n[::]:54322'])(
    'reaches the fixture without rg for the expected local binding %s', (binding) => {
      const result = runFixture('pika', binding)
      expect(result.error).toBeUndefined()
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toContain('fixture-database-exec')
      expect(result.stdout).toContain('Rollback-only attendance decommission contracts passed.')
    },
  )

  it.each([
    ['other-project', '0.0.0.0:54322'],
    ['pika', '0.0.0.0:54323'],
    ['pika', ''],
  ])('rejects project %s / binding %s before database execution', (project, binding) => {
    const result = runFixture(project, binding)
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Refusing unexpected database target.')
    expect(result.stdout).not.toContain('fixture-database-exec')
  })
})
