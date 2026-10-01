// Local-only PostgREST contract: synthetic fixtures, no migrations or hosted credentials.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { readContextualDailyLogs } from '../src/lib/server/contextual-daily-log-read'
import type { Database } from '../src/types/database'

async function main() {
  const container = 'supabase_db_pika'
  assert.equal(execFileSync('docker', ['inspect', container, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}'], { encoding: 'utf8' }).trim(), 'pika')
  assert.match(execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }), /:54322\s*$/m)
  const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  assert.equal(status.API_URL, 'http://127.0.0.1:54321', 'Only the exact local API may receive fixtures/credentials')
  assert.equal(typeof status.SERVICE_ROLE_KEY, 'string', 'Local CLI must provide a service-role credential')
  const service = createClient<Database>(status.API_URL, status.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  function sql(statement: string) {
    return execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XAt', '-v', 'ON_ERROR_STOP=1'], {
      input: `set statement_timeout = '15s'; set lock_timeout = '3s'; ${statement}`, encoding: 'utf8',
    }).trim()
  }
  const actor = randomUUID(), owner = randomUUID(), peer = randomUUID(), outsider = randomUUID()
  const joinedClass = randomUUID(), ownedClass = randomUUID()
  const ownEntry = randomUUID(), peerEntry = randomUUID(), ownerEntry = randomUUID()
  const tag = `dr_${randomUUID().slice(0, 8)}`
  const today = "(clock_timestamp() at time zone 'America/Toronto')::date"
  let created = false
  const read = (actorId: string, classroomId: string | null, client = service) => readContextualDailyLogs({
    supabase: client, actorId, classroomId, limit: classroomId ? null : 100,
  })
  try {
    sql(`begin;
      insert into public.users(id,email,role) values
        ('${actor}','${tag}_actor@example.invalid','teacher'),
        ('${owner}','${tag}_owner@example.invalid','student'),
        ('${peer}','${tag}_peer@example.invalid','student'),
        ('${outsider}','${tag}_outsider@example.invalid','teacher');
      set local role service_role;
      select public.set_effective_feature_entitlement_v1(gen_random_uuid(), u,
        'classrooms.create','manual',true,clock_timestamp(),null,1,'test:daily-read','daily_read_fixture',
        coalesce((select revision from public.effective_feature_entitlements where subject_user_id=u and feature_key='classrooms.create'),0))
      from unnest(array['${actor}'::uuid,'${owner}'::uuid]) u;
      reset role;
      insert into public.classrooms(id,teacher_id,title,class_code) values
        ('${joinedClass}','${owner}','${tag} joined','${tag}_j'),
        ('${ownedClass}','${actor}','${tag} owned','${tag}_o');
      insert into public.classroom_enrollments(classroom_id,student_id) values
        ('${joinedClass}','${actor}'),('${joinedClass}','${peer}'),('${ownedClass}','${actor}');
      insert into public.class_days(classroom_id,date,is_class_day) values
        ('${joinedClass}',${today},true),('${ownedClass}',${today},true);
      insert into public.entries(id,classroom_id,student_id,date,text,rich_content,on_time) values
        ('${ownEntry}','${joinedClass}','${actor}',${today},'Actor log','{"type":"doc","content":[]}',true),
        ('${peerEntry}','${joinedClass}','${peer}',${today},'Peer log','{"type":"doc","content":[]}',true),
        ('${ownerEntry}','${ownedClass}','${actor}',${today},'Owner legacy log','{"type":"doc","content":[]}',true);
      commit;`)
    created = true
    assert.deepEqual((await read(actor, joinedClass)).map((entry) => entry.id), [ownEntry])
    const broad = await read(actor, null)
    assert.deepEqual(broad.map((entry) => entry.id), [ownEntry])
    assert(!('classroom' in broad[0]), 'Relationship metadata must be stripped')
    assert.deepEqual((await read(peer, joinedClass)).map((entry) => entry.id), [peerEntry])
    assert.deepEqual(await read(outsider, null), [])
    await assert.rejects(read(actor, ownedClass), { statusCode: 403 })
    await assert.rejects(read(outsider, joinedClass), { statusCode: 403 })
    console.log('PASS real PostgREST joins: both global roles, own rows only, owner precedence, outsider and projection')

    // Force revocation to commit after scoped authorization but before its entry SELECT.
    async function afterPreflight(statement: string) {
      let revoked = false
      const client = createClient<Database>(status.API_URL, status.SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: async (input, init) => {
          if (new URL(String(input)).pathname === '/rest/v1/entries') {
            assert(!revoked, 'No retry or legacy fallback should issue another entries query')
            sql(statement)
            revoked = true
          }
          return fetch(input, init)
        } },
      })
      assert.deepEqual(await read(actor, joinedClass, client), [])
      assert(revoked, 'Preflight-to-read revocation was not exercised')
    }
    await afterPreflight(`delete from public.classroom_enrollments where classroom_id='${joinedClass}' and student_id='${actor}';`)
    sql(`insert into public.classroom_enrollments(classroom_id,student_id) values('${joinedClass}','${actor}');`)
    await afterPreflight(`update public.classrooms set archived_at=clock_timestamp() where id='${joinedClass}';`)
    assert.deepEqual(await read(actor, null), [])
    await assert.rejects(read(actor, joinedClass), { statusCode: 403 })
    console.log('PASS removal/archive committed between preflight and SELECT; no revoked logs disclosed')
  } finally {
    if (created) {
      sql(`begin;
        delete from public.classrooms where id in ('${joinedClass}','${ownedClass}') and teacher_id in ('${actor}','${owner}');
        delete from public.users where id in ('${actor}','${owner}','${peer}','${outsider}') and email like '${tag}_%@example.invalid';
        commit;`)
      assert.equal(sql(`select
        (select count(*) from public.users where id in ('${actor}','${owner}','${peer}','${outsider}')) +
        (select count(*) from public.classrooms where id in ('${joinedClass}','${ownedClass}')) +
        (select count(*) from public.entries where id in ('${ownEntry}','${peerEntry}','${ownerEntry}'));`), 'SET\nSET\n0')
      console.log('PASS fixture cleanup; only this run’s synthetic IDs removed')
    }
  }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
