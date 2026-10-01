#!/usr/bin/env node
// Local-only synthetic fixtures; no migration application or hosted credentials.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const container = 'supabase_db_pika'
assert.equal(execFileSync('docker', ['inspect', container, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}'], { encoding: 'utf8' }).trim(), 'pika')
assert.match(execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }), /:54322\s*$/m)
const actor = randomUUID()
const owner = randomUUID()
const classroom = randomUUID()
const entry = randomUUID()
const tag = `dl_${randomUUID().slice(0, 8)}`
const sessions = []
let fixturesCreated = false
const today = "(clock_timestamp() at time zone 'America/Toronto')::date"

class Session {
  constructor(name) {
    this.name = `${tag}_${name}`
    this.output = ''
    this.errors = ''
    this.pending = null
    this.closed = false
    this.child = spawn('docker', ['exec', '-i', '-e', `PGAPPNAME=${this.name}`, container,
      'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'])
    this.child.stdout.on('data', (chunk) => {
      this.output += chunk.toString()
      if (this.pending && this.output.includes(this.pending.marker)) {
        const pending = this.pending
        this.pending = null
        clearTimeout(pending.timer)
        pending.resolve(this.output.slice(0, this.output.indexOf(pending.marker)).trim())
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
    assert(!this.pending && !this.closed)
    this.output = ''
    this.errors = ''
    const marker = `done_${randomUUID()}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error(`Session timeout: ${this.name}`)), 20_000)
      this.pending = { marker, timer, resolve, reject }
      this.child.stdin.write(`${sql}\n\\echo ${marker}\n`)
    })
  }
  async close() {
    if (!this.closed) this.child.stdin.end('ROLLBACK;\n\\q\n')
    await this.done
  }
}
const admin = new Session('observer')
async function session(name) {
  const result = new Session(name)
  await result.run("SET statement_timeout = '12s'; SET lock_timeout = '10s';")
  return result
}
function save(version = 1) {
  return `SET LOCAL ROLE service_role;
    SELECT public.save_daily_log_for_member_v1('${actor}', '${classroom}', ${today},
      'Updated', '{"type":"doc","content":[]}', true,
      p_expected_version => ${version}, p_expected_entry_id => '${entry}');`
}
async function blocked(waiter, holder) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const found = await admin.run(`SELECT EXISTS (SELECT 1 FROM pg_stat_activity w, pg_stat_activity h
      WHERE w.application_name = '${waiter.name}' AND h.application_name = '${holder.name}'
        AND h.pid = ANY(pg_blocking_pids(w.pid)));`)
    if (found === 't') return
    assert(waiter.pending, 'Contender finished before the expected serialization point')
    await delay(30)
  }
  throw new Error('Expected transaction lock wait was not observed')
}

try {
  await admin.run(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '224')
      THEN RAISE EXCEPTION 'Migration 224 is required; this harness never applies it'; END IF;
    END $$;
    BEGIN;
    INSERT INTO public.users (id,email,role) VALUES
      ('${owner}', '${tag}_owner@example.invalid','student'),
      ('${actor}', '${tag}_member@example.invalid','teacher');
    SET LOCAL ROLE service_role;
    SELECT public.set_effective_feature_entitlement_v1(gen_random_uuid(), '${owner}',
      'classrooms.create','manual',true,clock_timestamp(),null,1,'test:224','daily_save_race',
      coalesce((SELECT revision FROM public.effective_feature_entitlements
        WHERE subject_user_id='${owner}' AND feature_key='classrooms.create'),0));
    RESET ROLE;
    INSERT INTO public.classrooms(id,teacher_id,title,class_code)
      VALUES('${classroom}','${owner}','Daily save race','${tag}');
    INSERT INTO public.classroom_enrollments(classroom_id,student_id) VALUES('${classroom}','${actor}');
    INSERT INTO public.class_days(classroom_id,date,is_class_day) VALUES('${classroom}',${today},true);
    INSERT INTO public.entries(id,classroom_id,student_id,date,text,rich_content,on_time)
      VALUES('${entry}','${classroom}','${actor}',${today},'Original','{"type":"doc","content":[]}',true);
    COMMIT;`)
  fixturesCreated = true

  // A legacy transaction can hold a row before it reaches lifecycle triggers.
  // New writes must fail promptly instead of waiting in a reverse-order cycle.
  for (const [name, lock] of [
    ['entry_row', `SELECT id FROM public.entries WHERE id='${entry}' FOR UPDATE`],
    ['classroom_row', `SELECT id FROM public.classrooms WHERE id='${classroom}' FOR UPDATE`],
    ['enrollment_row', `SELECT id FROM public.classroom_enrollments WHERE classroom_id='${classroom}' FOR UPDATE`],
    ['class_day_row', `SELECT id FROM public.class_days WHERE classroom_id='${classroom}' FOR UPDATE`],
  ]) {
    const holder = await session(`${name}_hold`)
    const writer = await session(`${name}_write`)
    await holder.run(`BEGIN; ${lock};`)
    await assert.rejects(writer.run(`BEGIN; ${save()}`), /55P03/)
    await holder.close()
    await writer.close()
    console.log(`Passed: ${name}_retry_without_deadlock`)
  }

  for (const [name, mutation, expected] of [
    ['removal_wins', `DELETE FROM public.classroom_enrollments WHERE classroom_id='${classroom}' AND student_id='${actor}'`, '42501'],
    ['archive_wins', `UPDATE public.classrooms SET archived_at=clock_timestamp() WHERE id='${classroom}'`, 'P0002'],
    ['class_day_wins', `UPDATE public.class_days SET is_class_day=false WHERE classroom_id='${classroom}'`, '22023'],
  ]) {
    const holder = await session(`${name}_hold`)
    const writer = await session(`${name}_write`)
    await holder.run(`BEGIN; SELECT private.try_lock_classroom_membership_change('${classroom}','${actor}'); ${mutation};`)
    const pending = writer.run(`BEGIN; ${save()}`)
    // Attach rejection handling before the holder commits.
    const denied = assert.rejects(pending, new RegExp(expected))
    await blocked(writer, holder)
    await holder.run('COMMIT;')
    await denied
    await holder.close()
    await writer.close()
    await admin.run(`UPDATE public.classrooms SET archived_at=null WHERE id='${classroom}';
      UPDATE public.class_days SET is_class_day=true WHERE classroom_id='${classroom}';
      INSERT INTO public.classroom_enrollments(classroom_id,student_id) VALUES('${classroom}','${actor}') ON CONFLICT DO NOTHING;`)
    console.log(`Passed: ${name}`)
  }

  const first = await session('first_save')
  const second = await session('stale_save')
  await first.run(`BEGIN; ${save()}`)
  const pending = second.run(`BEGIN; ${save()}`)
  await blocked(second, first)
  await first.run('COMMIT;')
  const result = JSON.parse(await pending)
  assert.equal(result.status, 409)
  assert.equal(result.entry.version, 2)
  await first.close()
  await second.close()
  console.log('Passed: simultaneous_save_preserves_revision_conflict')
} finally {
  const cleanup = admin.closed ? new Session('cleanup') : admin
  try {
    const workers = sessions.filter((item) => item !== admin && item !== cleanup)
    if (workers.length) {
      await cleanup.run(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE application_name IN (${workers.map((item) => `'${item.name}'`).join(',')});`)
    }
    await Promise.all(workers.map((item) => item.close()))
    if (fixturesCreated) {
      await cleanup.run(`ROLLBACK; BEGIN;
        DELETE FROM public.classrooms WHERE id='${classroom}' AND teacher_id='${owner}' AND title='Daily save race';
        DELETE FROM public.users WHERE (id='${actor}' AND email='${tag}_member@example.invalid')
          OR (id='${owner}' AND email='${tag}_owner@example.invalid'); COMMIT;`)
      assert.equal(await cleanup.run(`SELECT
        (SELECT count(*) FROM public.classrooms WHERE id='${classroom}') +
        (SELECT count(*) FROM public.users WHERE id IN ('${actor}','${owner}'));`), '0')
      console.log('Removed this run’s synthetic fixtures; real classroom data was not changed.')
    }
  } finally {
    await cleanup.close()
  }
}
