// Coordinator-run, local-only proof. Never run concurrently with another database proof.
// No committed enrollments: rollback-only SQL covers enrollment denial, leaving guard 168 untouched.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { ApiError } from '../src/lib/api-error'
import { hydrateClassroomRecord } from '../src/lib/server/classrooms'
import { updateContextualClassroomMetadata } from '../src/lib/server/contextual-classroom-metadata'
import { contextualClassroomMetadataPatchSchema, normalizeContextualClassroomMetadataPatch, type ContextualClassroomMetadataPatch } from '../src/lib/validations/contextual-classroom-metadata'
import type { Database } from '../src/types/database'

const container = 'supabase_db_pika'
const tag = `metadata_${randomUUID().replaceAll('-', '').slice(0, 12)}`
const slugTag = tag.replaceAll('_', '-')
const people = ['owner_teacher', 'owner_student', 'transfer_target'].map(label => ({
  label, id: randomUUID(), email: `${tag}_${label}@example.invalid`, role: label === 'owner_teacher' ? 'teacher' : 'student',
}))
function person(label: string) { const found = people.find(p => p.label === label); assert(found); return found.id }
const ownerTeacher = person('owner_teacher'), ownerStudent = person('owner_student'), transferTarget = person('transfer_target')
const classes = [{ id: randomUUID(), owner: ownerTeacher, label: 'a' }, { id: randomUUID(), owner: ownerStudent, label: 'b' }]
const classA = classes[0].id, classB = classes[1].id
const grants = people.map(p => ({ subject: p.id, operation: randomUUID() }))
const disableOperation = randomUUID()
const q = (value: string) => `'${value.replaceAll("'", "''")}'`
const ids = (values: readonly string[]) => values.map(q).join(',')
const userIds = people.map(p => p.id), classIds = classes.map(c => c.id)
const fixtureIds = [...userIds, ...classIds, ...grants.map(g => g.operation), disableOperation]
const peopleValues = people.map(p => `(${q(p.id)}::uuid,${q(p.email)},${q(p.role)})`).join(',')
const grantValues = [...grants, { subject: ownerTeacher, operation: disableOperation }]
  .map(g => `(${q(g.operation)}::uuid,${q(g.subject)}::uuid)`).join(',')
const forcedAfterFixture = 'Forced metadata post-fixture cleanup proof'
const forcedBeforeCapture = 'Forced metadata post-commit pre-capture cleanup proof'
let capturedCreated: Record<string, string> = {}
function command(binary: string, args: string[], input?: string) {
  try { return execFileSync(binary, args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 55_000, maxBuffer: 12_000_000 }).trim() }
  catch { throw new Error('Local metadata command failed (captured data withheld)') }
}
function sql(statement: string) {
  return command('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt', '-v', 'ON_ERROR_STOP=1'],
    `set statement_timeout='45s';set lock_timeout='8s';${statement}`)
}
function fingerprintSql() {
  return `create or replace function pg_temp.metadata_fingerprint() returns jsonb language plpgsql as $f$
    declare t record; result jsonb:='{}';value jsonb;
    begin for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.relkind in ('r','p') and n.nspname in ('public','private','storage') order by n.nspname,c.relname loop
      execute format('select jsonb_build_object(''count'',count(*),''digest'',md5(coalesce(string_agg(md5(to_jsonb(r)::text),'''' order by md5(to_jsonb(r)::text)),''''))) from %I.%I r',t.nspname,t.relname) into value;
      result:=result||jsonb_build_object(t.nspname||'.'||t.relname,value);end loop;return result;end;$f$;`
}
function fingerprint(): unknown { return JSON.parse(sql(`${fingerprintSql()}select pg_temp.metadata_fingerprint();`)) }
// Preallocated identities are checked absent before setup. Scan every public/private/Storage table,
// including nested JSON identities; unexpected dependencies cause rollback, not broad cascade deletion.
function residueSql() {
  return `create temp table fixture_ids(id text primary key) on commit drop;
    insert into fixture_ids values ${fixtureIds.map(id => `(${q(id)})`).join(',')};
    create function pg_temp.metadata_residue() returns jsonb language plpgsql as $r$
    declare t record;value bigint;result jsonb:='{}';begin
      for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where c.relkind in ('r','p') and n.nspname in ('public','private','storage') loop
        execute format('select count(*) from %I.%I r where exists(select 1 from fixture_ids f where position(f.id in to_jsonb(r)::text)>0)',t.nspname,t.relname) into value;
        if value>0 then result:=result||jsonb_build_object(t.nspname||'.'||t.relname,value);end if;
      end loop;return result;end;$r$;`
}
function residue(): unknown { return JSON.parse(sql(`begin;${residueSql()}select pg_temp.metadata_residue();rollback;`)) }
function guard() { return sql("select tgenabled from pg_trigger where tgrelid='private.pal_membership_generations'::regclass and tgname='guard_pal_membership_evidence' and not tgisinternal;") }
function rootRow(classroom: string) { return z.record(z.string(), z.unknown()).parse(JSON.parse(sql(`select to_jsonb(c) from public.classrooms c where id=${q(classroom)};`))) }
function publicationState(classroom: string): unknown {
  return JSON.parse(sql(`select jsonb_build_object('classroom',to_jsonb(c),
    'archive', (select to_jsonb(r) from public.classroom_archive_revisions r where r.classroom_id=c.id))
    from public.classrooms c where c.id=${q(classroom)};`))
}
const statusIs = (status: number) => (error: unknown) => error instanceof ApiError && error.statusCode === status
const rpcSql = (actor: string, classroom: string, patch: Record<string, unknown>) =>
  `public.update_classroom_metadata_for_owner_v1(${q(actor)}::uuid,${q(classroom)}::uuid,${q(JSON.stringify(patch))}::jsonb)`
function callSql(actor: string, classroom: string, patch: Record<string, unknown>) {
  return `do $call$ begin perform ${rpcSql(actor, classroom, patch)};end;$call$;`
}
function expectSql(actor: string, classroom: string, patch: Record<string, unknown>, state: string) {
  return `do $expected$ declare failed boolean:=false;begin begin perform ${rpcSql(actor, classroom, patch)};
    exception when others then if sqlstate<>${q(state)} then raise exception 'Unexpected metadata race state';end if;failed:=true;end;
    if not failed then raise exception 'Expected metadata race rejection';end if;end;$expected$;`
}

// Independent real psql connections, transaction-ready markers, bounded lock observation.
// A race is admitted only after pg_blocking_pids identifies the exact owned winner.
function session(label: string) {
  const name = `${tag}_${label}`
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'] })
  let output = '', ended = false, sequence = 0
  const exited = new Promise<void>(resolve => { child.once('exit', () => resolve());child.once('error', () => resolve()) })
  let pending: { marker: string; resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> } | undefined
  const failure = () => { ended = true; if (pending) { clearTimeout(pending.timer); pending.reject(new Error('Owned metadata transaction failed (data withheld)')); pending = undefined } }
  child.on('error', failure); child.on('exit', failure)
  child.stderr.on('data', () => { /* Never print captured database data. ON_ERROR_STOP ends failed commands. */ })
  child.stdout.on('data', chunk => {
    output += String(chunk)
    if (pending && output.split(/\r?\n/).includes(pending.marker)) {
      clearTimeout(pending.timer); const done = pending.resolve; pending = undefined; output = ''; done()
    }
  })
  function send(statement: string) {
    assert(!pending, 'One command per owned connection')
    if (ended) return Promise.reject(new Error('Owned metadata transaction ended'))
    const marker = `READY_${sequence++}`
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { pending = undefined; child.kill(); reject(new Error('Owned metadata transaction deadline exceeded')) }, 12_000)
      pending = { marker, resolve, reject, timer };child.stdin.write(`${statement}\n\\echo ${marker}\n`)
    })
  }
  return { name, send, async open() { await send(`set application_name=${q(name)};set statement_timeout='10s';set lock_timeout='8s';BEGIN;`) },
    async close() {
      if (!ended && !pending) { await send('ROLLBACK;').catch(() => undefined);child.stdin.end('\\q\n') }
      // Terminate only this invocation's exact owned connection if a failed waiter remains.
      // Killing the docker client alone would not certify rollback inside the container.
      sql(`select pg_terminate_backend(pid) from pg_stat_activity where application_name=${q(name)} and usename='postgres' and datname='postgres' and pid<>pg_backend_pid();`)
      if (!ended) child.kill()
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([exited, new Promise<void>((resolve, reject) => { timer = setTimeout(() => reject(new Error('Owned metadata connection did not exit')), 3_000) })])
        .finally(() => { if (timer) clearTimeout(timer) })
    },
  }
}
async function observedBlocking(waiter: string, winner: string) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (sql(`select exists(select 1 from pg_stat_activity w join pg_stat_activity b on b.pid=any(pg_blocking_pids(w.pid)) where w.application_name=${q(waiter)} and b.application_name=${q(winner)});`) === 't') return
    // Yield for I/O, never a guessed delay as evidence of readiness.
    await new Promise<void>(resolve => setTimeout(resolve, 20))
  }
  throw new Error('Expected owned metadata blocking edge was not observed')
}

async function main() {
  assert.equal(command('docker', ['inspect', container, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}']), 'pika')
  assert.match(command('docker', ['port', container, '5432/tcp']), /:54322\s*$/m)
  const local = z.object({ API_URL: z.literal('http://127.0.0.1:54321'), SERVICE_ROLE_KEY: z.string().min(20), DB_URL: z.string().refine(value => {
    try { const url = new URL(value);return ['postgres:', 'postgresql:'].includes(url.protocol) && ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '54322' && url.pathname === '/postgres' } catch { return false }
  }) }).safeParse(JSON.parse(command('supabase', ['status', '-o', 'json'])))
  if (!local.success) throw new Error('Local metadata target guard failed')
  const { API_URL, SERVICE_ROLE_KEY } = local.data
  assert.equal(sql("select to_regprocedure('public.update_classroom_metadata_for_owner_v1(uuid,uuid,jsonb)') is not null;"), 't')
  assert.equal(guard(), 'O');assert.deepEqual(residue(), {})
  const baseline = fingerprint()
  const installed = createClient<Database>(API_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const update = (actorId: string, classroomId: string, patch: ContextualClassroomMetadataPatch, supabase = installed) =>
    updateContextualClassroomMetadata({ supabase, actorId, classroomId, patch })
  function trace(actor: string, classroom: string, patch: ContextualClassroomMetadataPatch,
    options: { tamper?: (row: Record<string, unknown>) => unknown; fail?: boolean; lost_after_commit?: boolean } = {}) {
    let calls = 0
    const client = createClient<Database>(API_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
      calls++;assert.equal(calls, 1, 'No automatic replay, retry or legacy fallback')
      const url = new URL(input instanceof Request ? input.url : String(input))
      assert.equal(url.origin, API_URL);assert.equal(url.pathname, '/rest/v1/rpc/update_classroom_metadata_for_owner_v1')
      assert.equal(url.search, '');assert.equal(init?.method, 'POST')
      assert.deepEqual(JSON.parse(String(init?.body)), { p_actor_id: actor, p_classroom_id: classroom, p_patch: normalizeContextualClassroomMetadataPatch(patch) })
      if (options.fail) return new Response(JSON.stringify({ code: 'PT503', message: 'classroom_metadata_postcondition_failed', details: null, hint: null }), { status: 503, headers: { 'content-type': 'application/json' } })
      const response = await fetch(input, init)
      if (!response.ok) return response
      let body: unknown = await response.json()
      assert(body !== null && typeof body === 'object' && !Array.isArray(body), 'Real RPC returns one JSON object, not row cardinality arrays')
      if (options.lost_after_commit) throw new Error('Synthetic lost_after_commit response')
      const changed = z.record(z.string(), z.unknown()).parse(body)
      body = changed // Zod clones: wire mutation must be rebound to the actual response.
      if (options.tamper) body = options.tamper(changed)
      const headers = new Headers(response.headers);headers.delete('content-length')
      return new Response(JSON.stringify(body), { status: response.status, headers })
    } } })
    return { client, calls: () => calls }
  }
  try {
    // Transfer recipients need genuine creation capacity under trigger 166; metadata itself does not.
    sql(`BEGIN;insert into public.users(id,email,role) values ${peopleValues};
      select public.set_effective_feature_entitlement_v1(operation,u,'classrooms.create','manual',true,clock_timestamp(),null,3,
        'test:classroom-metadata',${q(tag)},coalesce((select revision from public.effective_feature_entitlements where subject_user_id=u and feature_key='classrooms.create'),0))
        from (values ${grants.map(g => `(${q(g.operation)}::uuid,${q(g.subject)}::uuid)`).join(',')}) f(operation,u);
      insert into public.classrooms(id,teacher_id,title,class_code) values ${classes.map(c => `(${q(c.id)},${q(c.owner)},${q(`${tag}_${c.label}`)},${q(`${tag}_${c.label}`)})`).join(',')};COMMIT;`)
    if (process.argv.includes('--verify-cleanup-after-commit-before-capture')) throw new Error(forcedBeforeCapture)
    capturedCreated = z.record(z.string(), z.string()).parse(JSON.parse(sql(`select jsonb_object_agg(id::text,created_at::text) from public.classrooms where id in (${ids(classIds)});`)))
    assert.equal(Object.keys(capturedCreated).length, classes.length)
    if (process.argv.includes('--verify-cleanup-after-fixture')) throw new Error(forcedAfterFixture)
    const full = contextualClassroomMetadataPatchSchema.parse({ title: '  SDK metadata  ', classCode: '', termLabel: '', allowEnrollment: false,
      joinPolicy: 'open_join', themeColor: 'teal', lessonPlanVisibility: 'all',
      featureVisibility: { attendance: true, classwork: false, tests: true, gradebook: true, student_grades: false, calendar: true, syllabus: false, announcements: true, achievements: true },
      actualSiteSlug: ` ${slugTag}-sdk `, actualSitePublished: true,
      actualSiteConfig: { overview: true, outline: true, resources: true, assignments: true, tests: true, lesson_plans: true, announcements: true, lesson_plan_scope: 'all' },
      courseOverviewMarkdown: 'Overview', courseOutlineMarkdown: 'Outline',
    })
    for (const c of classes) {
      // Persisted empty slug regression: omission must deny before commit for both owner roles.
      sql(`update public.classrooms set actual_site_slug='',actual_site_published=false where id=${q(c.id)};`)
      const emptySlugBefore = publicationState(c.id)
      const emptySlugPublish = trace(c.owner, c.id, { actualSitePublished: true })
      await assert.rejects(update(c.owner, c.id, { actualSitePublished: true }, emptySlugPublish.client), statusIs(400))
      assert.equal(emptySlugPublish.calls(), 1)
      assert.deepEqual(publicationState(c.id), emptySlugBefore)
      const unpublished = await update(c.owner, c.id, { actualSitePublished: false })
      assert.equal(unpublished.actual_site_slug, '')
      assert.equal(unpublished.actual_site_published, false)
      assert.deepEqual(unpublished, hydrateClassroomRecord(rootRow(c.id)))
      const patch = { ...full, actualSiteSlug: `${slugTag}-${c.label}` }, observed = trace(c.owner, c.id, patch)
      assert.deepEqual(await update(c.owner, c.id, patch, observed.client), hydrateClassroomRecord(rootRow(c.id)))
      assert.equal(observed.calls(), 1)
      await assert.rejects(update(transferTarget, c.id, { title: 'Forbidden' }), statusIs(403))
      await assert.rejects(update(c.owner, c.id, { actualSiteSlug: null }), statusIs(400))
      assert.equal((await update(c.owner, c.id, { actualSitePublished: false, actualSiteSlug: null })).actual_site_slug, null)
    }
    await assert.rejects(update(ownerTeacher, randomUUID(), { title: 'Missing' }), statusIs(404))
    const noop = { title: String(rootRow(classA).title) }
    const mutations: Array<(row: Record<string, unknown>) => unknown> = [
      row => ({ ...row, id: classB }), row => ({ ...row, teacher_id: transferTarget }), row => ({ ...row, archived_at: '2026-10-03T12:00:00Z' }),
      row => ({ ...row, unexpected: true }), row => { delete row.authoring_guidance_version_id;return row },
      row => ({ ...row, title: 'Substituted' }), row => [row], () => null,
    ]
    for (const tamper of mutations) { const observed = trace(ownerTeacher, classA, noop, { tamper });await assert.rejects(update(ownerTeacher, classA, noop, observed.client), statusIs(503));assert.equal(observed.calls(), 1) }
    const unavailable = trace(ownerTeacher, classA, noop, { fail: true })
    await assert.rejects(update(ownerTeacher, classA, noop, unavailable.client), statusIs(503));assert.equal(unavailable.calls(), 1)
    process.stdout.write('PASS metadata actual SDK both owner roles, exact normalized body/full owner hydration and strict wire failures without replay\n')

    for (const lifecycle of ['transfer', 'archive'] as const) {
      const change = lifecycle === 'transfer' ? `teacher_id=${q(transferTarget)}` : 'archived_at=clock_timestamp()'
      const reset = () => sql(`update public.classrooms set teacher_id=${q(ownerTeacher)},archived_at=null where id=${q(classA)};`)
      const winner = session(lifecycle === 'transfer' ? 'metadata_wins_transfer' : 'metadata_wins_archive'), waiter = session(`${lifecycle}_waiter`)
      try {
        await winner.open();await winner.send(callSql(ownerTeacher, classA, { title: `${tag}_${lifecycle}` }))
        await waiter.open();const blocked = waiter.send(`update public.classrooms set ${change} where id=${q(classA)};`)
        // Attach a rejection immediately while lock observation is in progress.
        void blocked.catch(() => undefined)
        await observedBlocking(waiter.name, winner.name);await winner.send('COMMIT;');await blocked;await waiter.send('COMMIT;')
        assert.equal(rootRow(classA).title, `${tag}_${lifecycle}`)
        await assert.rejects(update(ownerTeacher, classA, { title: 'Old authority' }), statusIs(403))
      } finally { await waiter.close();await winner.close();reset() }
      const lifecycleWinner = session(`${lifecycle}_wins_metadata`)
      try {
        await lifecycleWinner.open();await lifecycleWinner.send(`select id from public.classrooms where id=${q(classA)} FOR UPDATE;update public.classrooms set ${change} where id=${q(classA)};`)
        await assert.rejects(update(ownerTeacher, classA, { title: 'Contended' }), statusIs(409))
        await lifecycleWinner.send('COMMIT;');await assert.rejects(update(ownerTeacher, classA, { title: 'Stale' }), statusIs(403))
      } finally { await lifecycleWinner.close();reset() }
    }
    const slugWinner = session('slug_collision_winner'), slugWaiter = session('slug_collision_waiter')
    try {
      await slugWinner.open();await slugWinner.send(callSql(ownerTeacher, classA, { actual_site_slug: `${slugTag}-collision` }))
      await slugWaiter.open();const blocked = slugWaiter.send(expectSql(ownerStudent, classB, { actual_site_slug: `${slugTag}-collision` }, 'PT409'));void blocked.catch(() => undefined)
      await observedBlocking(slugWaiter.name, slugWinner.name);await slugWinner.send('COMMIT;');await blocked;await slugWaiter.send('COMMIT;')
      assert.equal(rootRow(classA).actual_site_slug, `${slugTag}-collision`);assert.equal(rootRow(classB).actual_site_slug, null)
    } finally { await slugWaiter.close();await slugWinner.close() }
    for (const publishFirst of [true, false]) {
      sql(`update public.classrooms set actual_site_published=false,actual_site_slug=${q(`${slugTag}-pair`)} where id=${q(classA)};`)
      const winner = session(`publish_clear_slug_${publishFirst}`)
      try {
        await winner.open();await winner.send(callSql(ownerTeacher, classA, publishFirst ? { actual_site_published: true } : { actual_site_slug: null }))
        const loserPatch = publishFirst ? { actualSiteSlug: null } : { actualSitePublished: true }
        await assert.rejects(update(ownerTeacher, classA, loserPatch), statusIs(409));await winner.send('COMMIT;')
        await assert.rejects(update(ownerTeacher, classA, loserPatch), statusIs(400))
        const row = rootRow(classA);assert(!(row.actual_site_published && !row.actual_site_slug))
      } finally { await winner.close() }
    }
    process.stdout.write('PASS metadata deterministic observed-blocking transfer/archive/slug/publication races preserve current authority and publishing invariants\n')
    const lostPatch = { title: `${tag}_committed_lost_response` }, lost = trace(ownerTeacher, classA, lostPatch, { lost_after_commit: true })
    await assert.rejects(update(ownerTeacher, classA, lostPatch, lost.client), statusIs(503));assert.equal(lost.calls(), 1)
    assert.equal(rootRow(classA).title, lostPatch.title, 'Lost transport does not establish SQL rollback')
    sql(`select public.set_effective_feature_entitlement_v1(${q(disableOperation)},${q(ownerTeacher)},'classrooms.create','manual',false,clock_timestamp(),null,null,
      'test:classroom-metadata',${q(tag)},(select revision from public.effective_feature_entitlements where subject_user_id=${q(ownerTeacher)} and feature_key='classrooms.create'));`)
    assert.equal((await update(ownerTeacher, classA, { themeColor: 'cyan' })).theme_color, 'cyan')
    process.stdout.write('PASS metadata committed-write lost-response uncertainty is reported without replay and no creation entitlement is required\n')
  } finally {
    // Exact synthetic UUIDs were absent before setup. Current full rows are snapshotted and
    // identity/dependency checked inside one transaction, including COMMIT-before-capture failure.
    const createdValues = classes.map(c => `(${q(c.id)}::uuid,${capturedCreated[c.id] ? `${q(capturedCreated[c.id])}::timestamptz` : 'null::timestamptz'})`).join(',')
    sql(`BEGIN;${residueSql()}
      do $operation_locks$ declare target uuid;begin
        for target in select id from (values ${classIds.map(id => `(${q(id)}::uuid)`).join(',')}) f(id) order by id loop
          if not public.classroom_purge_try_lock(target) then raise exception 'Metadata cleanup operation is contended';end if;
        end loop;
      end;$operation_locks$;
      -- Exact synthetic candidate locks precede all snapshots and dependency scans.
      -- Parent locks prevent new FK children; audit candidates are separately locked and provenance-bound.
      select 1 from public.users where id in (${ids(userIds)}) order by id FOR UPDATE NOWAIT;
      select 1 from public.classrooms where id in (${ids(classIds)}) order by id FOR UPDATE NOWAIT;
      select 1 from public.student_profiles where user_id in (${ids(userIds)}) order by id FOR UPDATE NOWAIT;
      select 1 from public.account_plans where subject_user_id in (${ids(userIds)}) order by subject_user_id FOR UPDATE NOWAIT;
      select 1 from public.account_plan_audit where subject_user_id in (${ids(userIds)}) order by id FOR UPDATE NOWAIT;
      select 1 from public.effective_feature_entitlements where subject_user_id in (${ids(userIds)}) order by subject_user_id,feature_key FOR UPDATE NOWAIT;
      select 1 from public.effective_feature_entitlement_audit where subject_user_id in (${ids(userIds)}) order by id FOR UPDATE NOWAIT;
      select 1 from public.classroom_archive_revisions where classroom_id in (${ids(classIds)}) order by classroom_id FOR UPDATE NOWAIT;
      select 1 from public.gradebook_categories where classroom_id in (${ids(classIds)}) order by id FOR UPDATE NOWAIT;
      create temp table metadata_class_snapshot on commit drop as select c.* from public.classrooms c where id in (${ids(classIds)});
      create temp table metadata_user_snapshot on commit drop as select u.* from public.users u where id in (${ids(userIds)});
      create temp table metadata_entitlement_audit_snapshot on commit drop as select a.* from public.effective_feature_entitlement_audit a where subject_user_id in (${ids(userIds)});
      create temp table metadata_plan_audit_snapshot on commit drop as select a.* from public.account_plan_audit a where subject_user_id in (${ids(userIds)});
      create temp table metadata_category_snapshot on commit drop as select g.* from public.gradebook_categories g where classroom_id in (${ids(classIds)});
      -- Include generated category identities so even a foreign-class reference denies cleanup.
      insert into fixture_ids select id::text from metadata_category_snapshot on conflict do nothing;
      create temp table metadata_default_category_expected on commit drop as
        select c.id classroom_id,d.* from metadata_class_snapshot c cross join
        (values ('Attendance'::text,10::numeric,10,0,false),('Term'::text,65::numeric,10,1,true),('Final'::text,25::numeric,10,2,false))
        d(name,percentage,default_assessment_weight,position,is_default);
      do $guard$ declare dependency text;begin
        if (select tgenabled from pg_trigger where tgrelid='private.pal_membership_generations'::regclass and tgname='guard_pal_membership_evidence') is distinct from 'O' then raise exception 'Generation guard differs';end if;
        for dependency in select jsonb_object_keys(pg_temp.metadata_residue()) loop
          if dependency not in ('public.users','public.student_profiles','public.account_plans','public.account_plan_audit','public.effective_feature_entitlements','public.effective_feature_entitlement_audit','public.classrooms','public.classroom_archive_revisions','public.gradebook_categories') then
            raise exception 'Unexpected private/Storage fixture dependency';end if;
        end loop;
        if (select count(*) from metadata_category_snapshot)<>3*(select count(*) from metadata_class_snapshot)
          or exists(select 1 from metadata_category_snapshot g full join metadata_default_category_expected e
            on g.classroom_id=e.classroom_id and g.name=e.name
            left join metadata_class_snapshot c on c.id=g.classroom_id
            where g.id is null or e.classroom_id is null
              or g.percentage is distinct from e.percentage or g.default_assessment_weight is distinct from e.default_assessment_weight
              or g.position is distinct from e.position or g.is_default is distinct from e.is_default
              or g.created_at is distinct from c.created_at or g.updated_at is distinct from g.created_at)
          then raise exception 'Unexpected synthetic default gradebook categories';end if;
        if exists(select 1 from metadata_user_snapshot u join (values ${peopleValues}) f(id,email,role) on u.id=f.id where u.email is distinct from f.email or u.role is distinct from f.role) then raise exception 'Synthetic user differs';end if;
        if exists(select 1 from metadata_class_snapshot c join (values ${createdValues}) f(id,created) on c.id=f.id where c.teacher_id not in (${ids(userIds)}) or (f.created is not null and c.created_at is distinct from f.created)) then raise exception 'Synthetic class differs';end if;
        if exists(select 1 from public.pal_event_outbox where student_id in (${ids(userIds)})) or exists(select 1 from private.removed_student_cleanup_jobs where classroom_id in (${ids(classIds)})) then raise exception 'Unexpected provider fixture state';end if;
        if exists(select 1 from (values ${classIds.map(id => `(${q(id)}::uuid)`).join(',')}) f(id) where public.attendance_classroom_has_state_v1(f.id)) then raise exception 'Unexpected attendance fixture state';end if;
      end;$guard$;
      create temp table metadata_provision_ops(operation_id uuid,subject_user_id uuid,primary key(operation_id,subject_user_id)) on commit drop;
      insert into metadata_provision_ops select a.operation_id,a.subject_user_id from metadata_plan_audit_snapshot a
        join (values ${peopleValues}) f(id,email,role) on f.id=a.subject_user_id join public.users u on u.id=f.id and u.email=f.email
        where a.actor_ref='system:user-provisioning' and a.reason_code='default_free_account_provisioning';
      delete from public.effective_feature_entitlement_audit a using metadata_entitlement_audit_snapshot s,(values ${grantValues}) f(op,u) where a.id=s.id and to_jsonb(a)=to_jsonb(s) and a.operation_id=f.op and a.subject_user_id=f.u and a.actor_ref='test:classroom-metadata' and a.reason_code=${q(tag)} and a.feature_key='classrooms.create';
      delete from public.effective_feature_entitlement_audit a using metadata_entitlement_audit_snapshot s,metadata_provision_ops p where a.id=s.id and to_jsonb(a)=to_jsonb(s) and a.operation_id=p.operation_id and a.subject_user_id=p.subject_user_id and a.actor_ref='system:user-provisioning' and a.reason_code='default_free_account_provisioning';
      delete from public.account_plan_audit a using metadata_plan_audit_snapshot s,metadata_provision_ops p where a.id=s.id and to_jsonb(a)=to_jsonb(s) and a.operation_id=p.operation_id and a.subject_user_id=p.subject_user_id and a.actor_ref='system:user-provisioning' and a.reason_code='default_free_account_provisioning';
      do $categories$ declare removed bigint;begin
        delete from public.gradebook_categories g using metadata_category_snapshot s
          where g.id=s.id and g.classroom_id=s.classroom_id and to_jsonb(g)=to_jsonb(s);
        get diagnostics removed=ROW_COUNT;
        if removed<>(select count(*) from metadata_category_snapshot) then raise exception 'Synthetic default category deletion differs';end if;
      end;$categories$;
      delete from public.classrooms c using metadata_class_snapshot s where c.id=s.id and to_jsonb(c)=to_jsonb(s);
      delete from public.users u using metadata_user_snapshot s where u.id=s.id and to_jsonb(u)=to_jsonb(s);
      ${fingerprintSql()}
      do $complete$ begin
        if pg_temp.metadata_residue()<>'{}'::jsonb then raise exception 'Synthetic residue differs';end if;
        if (select tgenabled from pg_trigger where tgrelid='private.pal_membership_generations'::regclass and tgname='guard_pal_membership_evidence') is distinct from 'O' then raise exception 'Generation guard differs';end if;
        if pg_temp.metadata_fingerprint() is distinct from ${q(JSON.stringify(baseline))}::jsonb then raise exception 'Whole-row global baseline differs';end if;
      end;$complete$;COMMIT;`)
    assert.deepEqual(residue(), {});assert.equal(guard(), 'O');assert.deepEqual(fingerprint(), baseline)
    process.stdout.write('PASS exact synthetic metadata cleanup, zero residual rows and global whole-row baseline counts\n')
  }
}
main().catch((error: unknown) => {
  process.stderr.write(error instanceof Error && error.message === forcedAfterFixture
    ? 'FAIL Forced metadata post-fixture cleanup proof (expected for --verify-cleanup-after-fixture)\n'
    : error instanceof Error && error.message === forcedBeforeCapture
      ? 'FAIL Forced metadata post-commit pre-capture cleanup proof (expected for --verify-cleanup-after-commit-before-capture)\n'
      : 'FAIL local metadata SDK proof (captured command/status data withheld)\n')
  process.exitCode = 1
})
