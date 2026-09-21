#!/usr/bin/env node
// Local-only multi-connection contracts. Creates random synthetic fixtures,
// removes them in finally, and never applies migrations or reads hosted secrets.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const container = 'supabase_db_pika'
assert.equal(
  execFileSync('docker', ['inspect', container, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}'], { encoding: 'utf8' }).trim(),
  'pika',
)

const tag = `classwork_reorder_${randomUUID().replaceAll('-', '').slice(0, 8)}`
const owner = randomUUID()
const classroom = randomUUID()
const assignmentOne = randomUUID()
const assignmentTwo = randomUUID()
const material = randomUUID()
const survey = randomUUID()
const sessions = []

function adminSql(sql) {
  return execFileSync('docker', [
    'exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
  ], { input: sql, encoding: 'utf8' }).trim()
}

class Session {
  constructor(name) {
    this.name = `cr_${tag.slice(-8)}_${name}`
    this.output = ''
    this.errors = ''
    this.pending = null
    this.closed = false
    this.child = spawn('docker', [
      'exec', '-i', '-e', `PGAPPNAME=${this.name}`, container,
      'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-qAt',
      '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
    ])
    this.child.stdout.on('data', (chunk) => {
      this.output += chunk.toString()
      if (this.pending && this.output.includes(this.pending.marker)) {
        const result = this.output.slice(0, this.output.indexOf(this.pending.marker)).trim()
        const pending = this.pending
        this.pending = null
        clearTimeout(pending.timer)
        pending.resolve(result)
      }
    })
    this.child.stderr.on('data', (chunk) => { this.errors += chunk.toString() })
    this.child.stdin.on('error', (error) => this.fail(error))
    this.child.on('error', (error) => this.fail(error))
    this.done = new Promise((resolve) => this.child.on('close', (code) => {
      this.closed = true
      this.fail(new Error(`${this.name} exited ${code}: ${this.errors}`))
      resolve()
    }))
    sessions.push(this)
  }

  fail(error) {
    if (!this.pending) return
    clearTimeout(this.pending.timer)
    this.pending.reject(error)
    this.pending = null
  }

  run(sql) {
    assert(!this.pending && !this.closed, 'Session must be idle and open')
    this.output = ''
    this.errors = ''
    const marker = `done_${randomUUID()}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error(`Session timeout: ${this.name}`)), 20_000)
      this.pending = { marker, resolve, reject, timer }
      this.child.stdin.write(`${sql}\n\\echo ${marker}\n`)
    })
  }

  async close() {
    if (!this.closed) this.child.stdin.end('ROLLBACK;\n\\q\n')
    await this.done
  }
}

const observer = new Session('observer')

async function waitBlocked(waiter, blocker) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const blocked = await observer.run(`select exists (
      select 1 from pg_stat_activity as waiting, pg_stat_activity as holding
      where waiting.application_name = '${waiter.name}'
        and holding.application_name = '${blocker.name}'
        and waiting.wait_event_type = 'Lock'
        and holding.pid = any(pg_blocking_pids(waiting.pid))
    );`)
    if (blocked === 't') return
    if (!waiter.pending) throw new Error(`${waiter.name} completed before blocking`)
    await delay(50)
  }
  throw new Error(`Expected ${waiter.name} to block on ${blocker.name}`)
}

const initialItems = `[
  {"type":"assignment","id":"${assignmentOne}"},
  {"type":"material","id":"${material}"},
  {"type":"assignment","id":"${assignmentTwo}"},
  {"type":"survey","id":"${survey}"}
]`
const reversedItems = `[
  {"type":"survey","id":"${survey}"},
  {"type":"assignment","id":"${assignmentTwo}"},
  {"type":"material","id":"${material}"},
  {"type":"assignment","id":"${assignmentOne}"}
]`

function reorderSql(items) {
  return `set role service_role;
    select result->>'ok' from (select public.reorder_classwork_items_for_owner_v1(
      '${owner}', '${classroom}', '${items}'::jsonb
    ) as result) as reordered;
    reset role;`
}

try {
  assert.equal(adminSql(`select exists (
    select 1 from supabase_migrations.schema_migrations where version = '197'
  );`), 't', 'Migration 197 must already be applied')

  adminSql(`
    insert into public.users (id, email, role)
    values ('${owner}', '${tag}-owner@example.invalid', 'student');
    set role service_role;
    select public.set_effective_feature_entitlement_v1(
      gen_random_uuid(), '${owner}', 'classrooms.create', 'manual', true,
      clock_timestamp(), null, 2, 'test:migration-197', '${tag}',
      coalesce((select revision from public.effective_feature_entitlements
        where subject_user_id = '${owner}' and feature_key = 'classrooms.create'), 0)
    );
    reset role;
    insert into public.classrooms (id, teacher_id, title, class_code)
    values ('${classroom}', '${owner}', '${tag}', upper(substr(replace('${classroom}', '-', ''), 1, 8)));
    insert into public.assignments (id, classroom_id, title, description, due_at, created_by, position) values
      ('${assignmentOne}', '${classroom}', 'First', '', clock_timestamp() + interval '7 days', '${owner}', 0),
      ('${assignmentTwo}', '${classroom}', 'Second', '', clock_timestamp() + interval '7 days', '${owner}', 2);
    insert into public.classwork_materials (id, classroom_id, title, content, created_by, position)
    values ('${material}', '${classroom}', 'Reference', '{"type":"doc","content":[]}'::jsonb, '${owner}', 1);
    insert into public.surveys (id, classroom_id, title, position, created_by)
    values ('${survey}', '${classroom}', 'Check-in', 3, '${owner}');
  `)

  const archive = new Session('archive_first')
  const deniedReorder = new Session('reorder_second')
  await archive.run(`begin; update public.classrooms set archived_at = clock_timestamp()
    where id = '${classroom}';`)
  const denied = deniedReorder.run(`begin; set role service_role;
    do $block$ begin
      perform public.reorder_classwork_items_for_owner_v1(
        '${owner}', '${classroom}', '${reversedItems}'::jsonb
      );
      raise exception 'Expected archived reorder denial';
    exception when sqlstate '55000' then
      if sqlerrm <> 'classwork_reorder_archived' then raise; end if;
    end $block$;
    reset role; select 'denied';`)
  await waitBlocked(deniedReorder, archive)
  await archive.run('commit;')
  assert.equal(await denied, 'denied')
  await deniedReorder.run('rollback;')
  assert.equal(adminSql(`select string_agg(kind || ':' || position, ',' order by position) from (
    select 'a1' as kind, position from public.assignments where id = '${assignmentOne}'
    union all select 'a2', position from public.assignments where id = '${assignmentTwo}'
    union all select 'm', position from public.classwork_materials where id = '${material}'
    union all select 's', position from public.surveys where id = '${survey}'
  ) ordered;`), 'a1:0,m:1,a2:2,s:3')
  console.log('Passed: archive_wins_contextual_classwork_reorder')

  adminSql(`update public.classrooms set archived_at = null where id = '${classroom}';`)

  const reorder = new Session('reorder_first')
  const laterArchive = new Session('archive_second')
  assert.equal(await reorder.run(`begin; ${reorderSql(reversedItems)}`), 'true')
  const archived = laterArchive.run(`begin; update public.classrooms set archived_at = clock_timestamp()
    where id = '${classroom}'; select 'archived';`)
  await waitBlocked(laterArchive, reorder)
  await reorder.run('commit;')
  assert.equal(await archived, 'archived')
  await laterArchive.run('commit;')
  assert.equal(adminSql(`select string_agg(kind || ':' || position, ',' order by position) from (
    select 'a1' as kind, position from public.assignments where id = '${assignmentOne}'
    union all select 'a2', position from public.assignments where id = '${assignmentTwo}'
    union all select 'm', position from public.classwork_materials where id = '${material}'
    union all select 's', position from public.surveys where id = '${survey}'
  ) ordered;`), 's:0,a2:1,m:2,a1:3')
  console.log('Passed: contextual_classwork_reorder_wins_archive')

  adminSql(`update public.classrooms set archived_at = null where id = '${classroom}';`)

  const creation = new Session('creation_first')
  const staleReorder = new Session('stale_reorder_second')
  const created = await creation.run(`begin; set role service_role;
    select result->'material'->>'id' from (select public.create_classwork_material_for_owner_v1(
      '${owner}', '${classroom}', 'Concurrent material', '{"type":"doc","content":[]}'::jsonb, true
    ) as result) as created;
    reset role;`)
  const stale = staleReorder.run(`begin; set role service_role;
    do $block$ begin
      perform public.reorder_classwork_items_for_owner_v1(
        '${owner}', '${classroom}', '${initialItems}'::jsonb
      );
      raise exception 'Expected stale classwork reorder denial';
    exception when sqlstate 'P0001' then
      if sqlerrm <> 'Classwork list changed. Refresh and try again.' then raise; end if;
    end $block$;
    reset role; select 'stale';`)
  await waitBlocked(staleReorder, creation)
  await creation.run('commit;')
  assert.equal(await stale, 'stale')
  await staleReorder.run('rollback;')
  assert.equal(adminSql(`select position from public.classwork_materials where id = '${created}';`), '4')
  console.log('Passed: classwork_creation_invalidates_waiting_reorder')
} finally {
  await Promise.allSettled(sessions.map((session) => session.close()))
  adminSql(`
    delete from public.classrooms where id = '${classroom}';
    delete from public.effective_feature_entitlement_audit where subject_user_id = '${owner}';
    delete from public.users where id = '${owner}';
  `)
}
