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

const tag = `classwork_creation_${randomUUID().replaceAll('-', '').slice(0, 8)}`
const owner = randomUUID()
const classroom = randomUUID()
const sessions = []

function adminSql(sql) {
  return execFileSync('docker', [
    'exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
  ], { input: sql, encoding: 'utf8' }).trim()
}

class Session {
  constructor(name) {
    this.name = `cc_${tag.slice(-8)}_${name}`
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

function materialSql(title) {
  return `set role service_role;
    select concat(result->'material'->>'id', '|', result->'material'->>'position')
    from (select public.create_classwork_material_for_owner_v1(
      '${owner}', '${classroom}', '${title}', '{"type":"doc","content":[]}'::jsonb, true
    ) as result) as creation;
    reset role;`
}

function surveySql(title) {
  return `set role service_role;
    select concat(result->'survey'->>'id', '|', result->'survey'->>'position')
    from (select public.create_survey_for_owner_v1(
      '${owner}', '${classroom}', '${title}', true, false
    ) as result) as creation;
    reset role;`
}

function assignmentSql(title) {
  return `set role service_role;
    select concat(result->'assignment'->>'id', '|', result->'assignment'->>'position')
    from (select public.create_assignment_for_owner_v1(
      '${owner}', '${classroom}', '${title}', '', 'Instructions',
      '{"type":"doc","content":[]}'::jsonb,
      clock_timestamp() + interval '7 days', '[]'::jsonb
    ) as result) as creation;
    reset role;`
}

try {
  assert.equal(adminSql(`select exists (
    select 1 from supabase_migrations.schema_migrations where version = '193'
  );`), 't', 'Migration 193 must already be applied')

  adminSql(`
    insert into public.users (id, email, role)
    values ('${owner}', '${tag}-owner@example.invalid', 'student');
    set role service_role;
    select public.set_effective_feature_entitlement_v1(
      gen_random_uuid(), '${owner}', 'classrooms.create', 'manual', true,
      clock_timestamp(), null, 10, 'test:migration-193', '${tag}',
      coalesce((select revision from public.effective_feature_entitlements
        where subject_user_id = '${owner}' and feature_key = 'classrooms.create'), 0)
    );
    reset role;
    insert into public.classrooms (id, teacher_id, title, class_code)
    values ('${classroom}', '${owner}', '${tag}', upper(substr(replace('${classroom}', '-', ''), 1, 8)));
  `)

  const material = new Session('material_first')
  const survey = new Session('survey_second')
  const materialResult = await material.run(`begin; ${materialSql('Material first')}`)
  const surveyResultPromise = survey.run(`begin; ${surveySql('Survey second')}`)
  await waitBlocked(survey, material)
  await material.run('commit;')
  const surveyResult = await surveyResultPromise
  await survey.run('commit;')
  assert.equal(materialResult.split('|')[1], '0')
  assert.equal(surveyResult.split('|')[1], '1')
  console.log('Passed: material_then_survey_positions_serialize')

  const surveyFirst = new Session('survey_first')
  const assignment = new Session('assignment_second')
  const surveyFirstResult = await surveyFirst.run(`begin; ${surveySql('Survey first')}`)
  const assignmentResultPromise = assignment.run(`begin; ${assignmentSql('Assignment second')}`)
  await waitBlocked(assignment, surveyFirst)
  await surveyFirst.run('commit;')
  const assignmentResult = await assignmentResultPromise
  await assignment.run('commit;')
  assert.equal(surveyFirstResult.split('|')[1], '2')
  assert.equal(assignmentResult.split('|')[1], '3')
  assert.equal(adminSql(`select count(distinct position) from (
    select position from public.assignments where classroom_id = '${classroom}'
    union all select position from public.classwork_materials where classroom_id = '${classroom}'
    union all select position from public.surveys where classroom_id = '${classroom}'
  ) classwork;`), '4')
  console.log('Passed: survey_then_assignment_positions_serialize')
} finally {
  await Promise.allSettled(sessions.map((session) => session.close()))
  adminSql(`
    delete from public.classrooms where id = '${classroom}';
    delete from public.effective_feature_entitlement_audit where subject_user_id = '${owner}';
    delete from public.users where id = '${owner}';
  `)
}
