import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/227_contextual_lesson_plan_bulk_write.sql', 'utf8')

describe('contextual lesson-plan bulk write migration source', () => {
  it('exposes only the service-role transaction', () => {
    expect(sql).toMatch(/create function public\.save_lesson_plans_for_owner_v1\(/i)
    expect(sql).toMatch(/security definer\s+set search_path = ''/i)
    expect(sql).toMatch(/revoke all on function public\.save_lesson_plans_for_owner_v1\([\s\S]*?from public, anon, authenticated/i)
    expect(sql).toMatch(/grant execute on function public\.save_lesson_plans_for_owner_v1\([\s\S]*?to service_role/i)
  })

  it('locks operation, parent, all heads, then all plans before applying dates', () => {
    const positions = [
      'pika-classroom-operation:',
      'guard_classroom_purge_lifecycle',
      'from public.classrooms as classroom',
      'v_teacher_id is distinct from p_actor_id',
      'from public.lesson_plan_mutation_heads as head',
      'from public.lesson_plans as plan',
      'save_lesson_plan_for_owner_v1(',
    ].map((needle) => sql.indexOf(needle))
    expect(positions[0]).toBeGreaterThan(0)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(sql.match(/for update nowait/gi)).toHaveLength(3)
  })

  it('keeps ordered date behavior and whole-request rollback', () => {
    expect(sql).toMatch(/p_client_id is not null[\s\S]*?upsert[\s\S]*?clear/i)
    expect(sql).toMatch(/p_client_id is null[\s\S]*?clear[\s\S]*?upsert/i)
    expect(sql).toMatch(/when sqlstate '40001' or sqlstate '40P01' or sqlstate '55P03'\s+or sqlstate '55000'[\s\S]*?errcode = 'PT409'/i)
    expect(sql).not.toMatch(/disable trigger|set session_replication_role|update public\.lesson_plan_mutation_heads/i)
  })

  it('guards direct RPC array dimensions and accepts only stale-null upserts', () => {
    expect(sql).toMatch(/cardinality\(p_cleared_dates\) > 250/)
    expect(sql).toMatch(/array_ndims\(p_cleared_dates\) <> 1/)
    expect(sql).toMatch(/v_row = 'null'::jsonb and v_result->'applied' = 'true'::jsonb/)
    expect(sql).toMatch(/exception when sqlstate '22007' or sqlstate '22008'/)
  })
})

const harness = readFileSync('scripts/check-contextual-lesson-plan-bulk-write-concurrency.mjs', 'utf8')

describe('contextual lesson-plan bulk synthetic cleanup source', () => {
  it('uses owner cascade for Blueprint teardown without bypassing lifecycle guards', () => {
    expect(harness).not.toContain('delete from public.course_blueprints')
    expect(harness).toContain('delete from public.users')
  })

  it('proves the earlier late-conflict save is accepted rather than already stale', () => {
    expect(harness).toContain('const rollbackClient = randomUUID()')
    expect(harness).toContain('assert.equal(earlierProof.results[0].applied, true)')
    expect(harness).toContain('p_client_id: rollbackClient')
  })

  it('handles strict automatic Free audit rows for all three tagged synthetic users', () => {
    expect(harness).toContain('default_free_account_provisioning')
    expect(harness).toContain('system:user-provisioning')
    expect(harness).toContain('account_plan_audit')
    expect(harness).toContain('effective_feature_entitlement_audit')
    expect(harness).toMatch(/create temp table bulk_audit_cleanup_ops\s*\(\s*operation_id uuid,\s*subject_user_id uuid/i)
    expect(harness).toMatch(/delete from public\.account_plan_audit[\s\S]*?using bulk_audit_cleanup_ops/i)
    expect(harness).toMatch(/delete from public\.effective_feature_entitlement_audit[\s\S]*?using bulk_audit_cleanup_ops/i)
    expect(harness).toMatch(/\$\{outsider\}[\s\S]*?\$\{tag\}_outsider@example\.invalid/)
  })

  it('attempts exact cleanup even if fixture creation returns ambiguously and verifies forced failure teardown', () => {
    expect(harness).not.toMatch(/if \(created\) \{\s*sql\(`begin;/)
    expect(harness).toContain('--verify-cleanup-after-fixture')
    expect(harness).toContain('Forced post-fixture cleanup proof')
    expect(harness).toMatch(/delete from public\.users[\s\S]*?PASS exact synthetic fixture cleanup with zero residual rows/)
  })
})

describe('contextual lesson-plan bulk CI cleanup proof', () => {
  it('uses portable checks and requires both forced-error and zero-residue evidence', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
    const step = workflow.split('name: Verify contextual lesson-plan bulk atomicity and failed-fixture cleanup')[1]
      ?.split('\n      - name:')[0] ?? ''
    const commands = [...step.matchAll(/^\s+(?:rg|grep) -F .+$/gm)].map(([line]) => line.trim())
    expect(commands).toEqual([
      'grep -F \'Error: Forced post-fixture cleanup proof\' "$cleanup_log"',
      'grep -F \'PASS exact synthetic fixture cleanup with zero residual rows\' "$cleanup_log"',
    ])
    const directory = mkdtempSync(join(tmpdir(), 'pika-bulk-ci-proof-'))
    const logPath = join(directory, 'cleanup.log')
    const verify = (contents: string) => {
      writeFileSync(logPath, contents)
      return spawnSync('bash', ['-e', '-o', 'pipefail', '-c', commands.join('\n')], {
        encoding: 'utf8',
        env: { ...process.env, cleanup_log: logPath },
      }).status
    }
    const error = 'Error: Forced post-fixture cleanup proof\n'
    const cleanup = 'PASS exact synthetic fixture cleanup with zero residual rows\n'
    try {
      expect(verify(error + cleanup)).toBe(0)
      expect(verify(error)).not.toBe(0)
      expect(verify(cleanup)).not.toBe(0)
      expect(verify('')).not.toBe(0)
    } finally {
      rmSync(directory, { recursive: true })
    }
  })
})
