#!/usr/bin/env node
// Local-only concurrent quota contract. Synthetic fixtures are always removed.
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const container = 'supabase_db_pika'
assert.equal(
  execFileSync('docker', ['inspect', container, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}'], { encoding: 'utf8' }).trim(),
  'pika',
)

const subject = randomUUID()
const entitlementOperation = randomUUID()
const operationA = randomUUID()
const operationB = randomUUID()
const tag = subject.replaceAll('-', '').slice(0, 10)

function adminSql(sql) {
  return execFileSync('docker', [
    'exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
  ], { input: sql, encoding: 'utf8' }).trim()
}

async function reserve(operation, usageRef) {
  const sql = `set role service_role;
    select public.reserve_feature_usage_v1(
      '${operation}', '${subject}', 'grading.ai',
      'assignment_ai_grading', '${usageRef}', 1, 3600
    ) #>> '{reservation,status}';`
  return execFileAsync('docker', [
    'exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql,
  ], {
    encoding: 'utf8',
  })
}

try {
  assert.equal(adminSql(`select exists (
    select 1 from supabase_migrations.schema_migrations where version = '201'
  );`), 't', 'Migration 201 must already be applied')

  adminSql(`
    insert into public.users (id, email, role)
    values ('${subject}', '${tag}@example.invalid', 'student');
    set role service_role;
    select public.set_effective_feature_entitlement_v1(
      '${entitlementOperation}', '${subject}', 'grading.ai', 'manual', true,
      clock_timestamp(), null, 1, 'test:migration-201', 'concurrent_quota_fixture', 0
    );
    reset role;
  `)

  const results = await Promise.allSettled([
    reserve(operationA, 'assignment:race:a'),
    reserve(operationB, 'assignment:race:b'),
  ])
  const successes = results.filter((result) => result.status === 'fulfilled')
  const failures = results.filter((result) => result.status === 'rejected')
  assert.equal(successes.length, 1, 'exactly one concurrent reservation must succeed')
  assert.equal(successes[0].value.stdout.trim(), 'reserved')
  assert.equal(failures.length, 1, 'exactly one concurrent reservation must fail')
  assert.match(`${failures[0].reason.stderr ?? ''}`, /feature_usage_quota_exhausted/)
  assert.equal(adminSql(`select count(*) from public.feature_usage_reservations
    where subject_user_id = '${subject}' and status = 'reserved';`), '1')
  console.log('Passed: concurrent feature usage reservations cannot overspend quota')
} finally {
  adminSql(`
    delete from public.feature_usage_reservations where subject_user_id = '${subject}';
    delete from public.effective_feature_entitlement_audit where subject_user_id = '${subject}';
    delete from public.users where id = '${subject}';
  `)
}
