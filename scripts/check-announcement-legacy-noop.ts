// Local SDK characterization only. No schema, hosted calls, activation, or real user fixtures.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database'

async function main() {
  const container = 'supabase_db_pika'
  assert.equal(execFileSync('docker', ['inspect', container, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}'], { encoding: 'utf8' }).trim(), 'pika')
  assert.match(execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }), /:54322\s*$/m)
  // Capture status privately: never log the service key or an exec error's stdout.
  const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }))
  assert.equal(status.API_URL, 'http://127.0.0.1:54321')
  assert.equal(typeof status.SERVICE_ROLE_KEY, 'string')
  const service = createClient<Database>(status.API_URL, status.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => {
      const url = new URL(String(input))
      assert.equal(url.origin, 'http://127.0.0.1:54321')
      return fetch(input, { ...init, signal: AbortSignal.timeout(15_000) })
    } },
  })
  function sql(statement: string) {
    return execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt', '-v', 'ON_ERROR_STOP=1'], {
      input: `set statement_timeout='15s'; set lock_timeout='3s'; ${statement}`,
      encoding: 'utf8', timeout: 20_000,
    }).trim()
  }
  const tag = `annnoop_${randomUUID().replaceAll('-', '')}`
  const user = randomUUID(), classroom = randomUUID(), announcement = randomUUID(), operation = randomUUID()
  const email = `${tag}@example.invalid`
  const forcedCleanup = process.argv.includes('--verify-cleanup-after-fixture')
  function state() {
    return JSON.parse(sql(`select jsonb_build_object(
      'announcement', (select to_jsonb(a) from public.announcements a where id='${announcement}' and classroom_id='${classroom}'),
      'archive_revision', (select revision from public.classroom_archive_revisions where classroom_id='${classroom}')
    );`)) as { announcement: { updated_at: string }; archive_revision: number }
  }
  try {
    sql(`begin;
      insert into public.users(id,email,role) values('${user}','${email}','teacher');
      set local role service_role;
      select public.set_effective_feature_entitlement_v1('${operation}','${user}','classrooms.create','manual',true,
        clock_timestamp(),null,1,'test:announcement-noop','${tag}',
        coalesce((select revision from public.effective_feature_entitlements where subject_user_id='${user}' and feature_key='classrooms.create'),0));
      reset role;
      insert into public.classrooms(id,teacher_id,title,class_code)
        values('${classroom}','${user}','${tag}','${tag}');
      insert into public.announcements(id,classroom_id,content,created_by,is_draft,published_at)
        values('${announcement}','${classroom}','${tag}','${user}',false,'2020-01-01T00:00:00Z');
      commit;`)
    if (forcedCleanup) throw new Error('Forced post-fixture cleanup proof')
    const before = state()
    assert(before.announcement)
    assert.equal(typeof before.archive_revision, 'number')
    // Exact legacy call when is_draft:false is the sole field on an already-published row.
    const response = await service.from('announcements').update({}).eq('id', announcement).select().single()
    const after = state()
    process.stdout.write(`${JSON.stringify({
      target: 'local pika / 127.0.0.1:54321 / 54322',
      status: response.status, statusText: response.statusText,
      data: response.data, error: response.error,
      before: { updated_at: before.announcement.updated_at, archive_revision: before.archive_revision },
      after: { updated_at: after.announcement.updated_at, archive_revision: after.archive_revision },
    }, null, 2)}\n`)
    assert.deepEqual(after, before, 'Empty legacy update changed persisted announcement or archive revision')
    assert.equal(response.status, 406)
    assert.equal(response.data, null)
    assert.equal(response.error?.code, 'PGRST116')
    process.stdout.write('PASS legacy empty PATCH returns PGRST116/406 with unchanged announcement and archive revision\n')
  } finally {
    // Unconditional, even after an ambiguous setup outcome. Every delete is fixture-bound.
    sql(`begin;
      create temp table announcement_noop_provision_ops(operation_id uuid,subject_user_id uuid,primary key(operation_id,subject_user_id)) on commit drop;
      insert into announcement_noop_provision_ops select audit.operation_id,audit.subject_user_id
        from public.account_plan_audit audit join public.users u on u.id=audit.subject_user_id
        where u.id='${user}' and u.email='${email}'
          and audit.actor_ref='system:user-provisioning' and audit.reason_code='default_free_account_provisioning';
      delete from public.effective_feature_entitlement_audit audit
        where audit.operation_id='${operation}' and audit.subject_user_id='${user}'
          and audit.actor_ref='test:announcement-noop' and audit.reason_code='${tag}' and audit.feature_key='classrooms.create'
          and exists(select 1 from public.users where id='${user}' and email='${email}');
      delete from public.effective_feature_entitlement_audit audit using announcement_noop_provision_ops operation
        where audit.operation_id=operation.operation_id and audit.subject_user_id=operation.subject_user_id
          and audit.actor_ref='system:user-provisioning' and audit.reason_code='default_free_account_provisioning' and audit.feature_key='classrooms.create';
      delete from public.account_plan_audit audit using announcement_noop_provision_ops operation
        where audit.operation_id=operation.operation_id and audit.subject_user_id=operation.subject_user_id
          and audit.actor_ref='system:user-provisioning' and audit.reason_code='default_free_account_provisioning';
      delete from public.classrooms where id='${classroom}' and teacher_id='${user}' and title='${tag}' and class_code='${tag}';
      delete from public.users where id='${user}' and email='${email}';
      commit;`)
    const residue = sql(`select
      (select count(*) from public.users where id='${user}')+
      (select count(*) from public.classrooms where id='${classroom}')+
      (select count(*) from public.announcements where id='${announcement}' or classroom_id='${classroom}')+
      (select count(*) from public.announcement_reads where announcement_id='${announcement}' or user_id='${user}')+
      (select count(*) from public.classroom_archive_revisions where classroom_id='${classroom}')+
      (select count(*) from public.account_plans where subject_user_id='${user}')+
      (select count(*) from public.account_plan_audit where subject_user_id='${user}')+
      (select count(*) from public.effective_feature_entitlements where subject_user_id='${user}')+
      (select count(*) from public.effective_feature_entitlement_audit where subject_user_id='${user}' or operation_id='${operation}');`)
    assert.equal(residue, '0')
    process.stdout.write('PASS exact synthetic fixture cleanup with zero residual rows\n')
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Announcement noop characterization failed')
  process.exitCode = 1
})
