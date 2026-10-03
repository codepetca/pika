// Coordinator execution only. Importing this module performs no commands or writes.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

export const ACK = 'I_UNDERSTAND_THIS_CREATES_AND_REMOVES_ONLY_LOCAL_ASSIGNMENT_FIXTURES'
export const API = 'http://127.0.0.1:54321'
export const CLEANUP_PASS = 'PASS shared-assignment exact cleanup; whole-row baseline equal; zero residue; guard168 O'
export const NORMAL_PASS = 'PASS shared-assignment actual routes and real RPCs; shared cohort only; old pair gates OFF'
export const FORCED = {
  'after-fixture': 'FAIL shared-assignment FORCED_AFTER_FIXTURE',
  'before-capture': 'FAIL shared-assignment FORCED_COMMIT_BEFORE_CAPTURE',
} as const
export type ProofMode = 'normal' | keyof typeof FORCED
export type Actor = { id: string; email: string; role: 'teacher' | 'student' }

export function demand(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
export function same(actual: unknown, expected: unknown, message: string) {
  demand(isDeepStrictEqual(actual, expected), message) // No row contents in assertion diagnostics.
}
export const q = (value: string) => `'${value.replaceAll("'", "''")}'`
const ids = (values: readonly string[]) => values.map(q).join(',')

export function validateLaunch(env: NodeJS.ProcessEnv) {
  demand(env.PIKA_SHARED_ASSIGNMENT_WRITE_ACK === ACK, 'Local synthetic write acknowledgement required')
  demand(env.PIKA_SHARED_ASSIGNMENT_WRITE_WRAPPER === 'local-status-v1', 'Run only through the local status wrapper')
  const mode = env.PIKA_SHARED_ASSIGNMENT_WRITE_MODE
  demand(mode === 'normal' || mode === 'after-fixture' || mode === 'before-capture', 'Unknown proof mode')
  demand(env.PIKA_SHARED_ASSIGNMENT_WRITE_API === API, 'Exact local API target required')
  try {
    const db = new URL(env.PIKA_SHARED_ASSIGNMENT_WRITE_DB ?? '')
    demand(['postgres:', 'postgresql:'].includes(db.protocol) && ['127.0.0.1', 'localhost'].includes(db.hostname)
      && db.port === '54322' && db.pathname === '/postgres' && !db.search && !db.hash, 'Exact local database target required')
    const secret = env.PIKA_SHARED_ASSIGNMENT_WRITE_SECRET ?? ''
    const parts = secret.split('.')
    demand(parts.length === 3, 'Local demo service JWT required')
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    demand(claims.iss === 'supabase-demo' && claims.role === 'service_role', 'Local demo service JWT required')
    demand(Boolean(env.PIKA_SHARED_ASSIGNMENT_WRITE_PUBLIC), 'Local public credential required')
    return { secret, publicKey: env.PIKA_SHARED_ASSIGNMENT_WRITE_PUBLIC!, mode: mode as ProofMode }
  } catch { throw new Error('Local proof target or credentials rejected (values withheld)') }
}

export function containedFetch(original: typeof fetch, observed: string[]) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    demand(url.origin === API && !url.username && !url.password && !url.hash
      && url.pathname.startsWith('/rest/v1/'), 'Proof blocked provider, Storage or nonlocal fetch')
    observed.push(url.pathname)
    return original(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(12_000) })
  }) as typeof fetch
}

function command(binary: string, args: string[], input?: string) {
  try { return execFileSync(binary, args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 55_000, maxBuffer: 12_000_000 }).trim() }
  catch { throw new Error('Local proof command failed (captured output withheld)') }
}
export function assertContainers() {
  for (const [container, internalPort, externalPort] of [
    ['supabase_db_pika', '5432/tcp', '54322'], ['supabase_kong_pika', '8000/tcp', '54321'],
  ]) {
    demand(command('docker', ['inspect', container, '--format', '{{.State.Running}}']) === 'true', 'Exact local container must be running')
    demand(command('docker', ['inspect', container, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}']) === 'pika', 'Exact local project label required')
    const ports = command('docker', ['port', container, internalPort]).split(/\r?\n/)
    demand(ports.length > 0 && ports.every(port => port.endsWith(`:${externalPort}`)), 'Exact local container port required')
  }
}

export function newFixture() {
  const tag = `sharedwrite_${randomUUID().replaceAll('-', '')}`
  const people: Actor[] = ['teacher', 'student', 'teacher'].map((role, i) => ({
    id: randomUUID(), email: `${tag}_${i}@example.invalid`, role: role as Actor['role'],
  }))
  const classes = people.slice(0, 2).map((owner, i) => ({ id: randomUUID(), owner: owner.id, title: `${tag}_class_${i}`, code: `${tag}_${i}` }))
  const enrollments = [
    { id: randomUUID(), classroom: classes[0].id, student: people[1].id },
    { id: randomUUID(), classroom: classes[1].id, student: people[0].id },
    { id: randomUUID(), classroom: classes[1].id, student: people[1].id }, // Historical self enrollment.
  ]
  const grants = people.slice(0, 2).map(p => ({ subject: p.id, operation: randomUUID() }))
  const docIds = classes.map(() => randomUUID())
  const sessionIds = classes.map(() => randomUUID())
  const requirementIds = classes.map(() => randomUUID())
  return { tag, people, classes, enrollments, grants, docIds, sessionIds, requirementIds }
}
export type Fixture = ReturnType<typeof newFixture>

const guardSql = "(select tgenabled from pg_trigger where tgrelid='private.pal_membership_generations'::regclass and tgname='guard_pal_membership_evidence' and not tgisinternal)"
export function fingerprintSql() {
  return `create or replace function pg_temp.shared_write_fingerprint() returns jsonb language plpgsql as $f$
    declare t record;result jsonb:='{}';v jsonb;begin
    for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.relkind in ('r','p') and n.nspname in ('public','private','storage') order by n.nspname,c.relname loop
      execute format('select jsonb_build_object(''count'',count(*),''digest'',md5(coalesce(string_agg(md5(to_jsonb(r)::text),'''' order by md5(to_jsonb(r)::text)),''''))) from %I.%I r',t.nspname,t.relname) into v;
      result:=result||jsonb_build_object(t.nspname||'.'||t.relname,v);end loop;return result;end;$f$;`
}
function allocated(f: Fixture) {
  return [...f.people.map(p => p.id), ...f.classes.map(c => c.id), ...f.enrollments.map(e => e.id),
    ...f.grants.map(g => g.operation), ...f.docIds, ...f.sessionIds, ...f.requirementIds, f.tag]
}
function scanSql(f: Fixture) {
  return `create temp table proof_ids(id text primary key) on commit drop;
    insert into proof_ids values ${allocated(f).map(id => `(${q(id)})`).join(',')};
    create function pg_temp.shared_write_residue() returns jsonb language plpgsql as $scan$
      declare t record;n bigint;result jsonb:='{}';begin
      for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where c.relkind in ('r','p') and n.nspname in ('public','private','storage') loop
        execute format('select count(*) from %I.%I r where exists(select 1 from proof_ids f where position(f.id in to_jsonb(r)::text)>0)',t.nspname,t.relname) into n;
        if n>0 then result:=result||jsonb_build_object(t.nspname||'.'||t.relname,n);end if;
      end loop;return result;end;$scan$;`
}

// Every permitted table has an independently bound ownership predicate. No Storage,
// provider outbox, roster, attendance, job, account mutation or unknown dependency is eligible.
export function ownedTables(f: Fixture): Array<[string, string]> {
  const users = ids(f.people.map(p => p.id)), classes = ids(f.classes.map(c => c.id))
  const assignments = `select id from public.assignments where classroom_id in (${classes})`
  const docs = `select id from public.assignment_docs where assignment_id in (${assignments})`
  return [
    ['public.users', `r.id in (${users})`],
    ['public.classrooms', `r.id in (${classes})`],
    ['public.student_profiles', `r.user_id in (${users})`],
    ['public.account_plans', `r.subject_user_id in (${users})`],
    ['public.account_plan_audit', `r.subject_user_id in (${users})`],
    ['public.effective_feature_entitlements', `r.subject_user_id in (${users})`],
    ['public.effective_feature_entitlement_audit', `r.subject_user_id in (${users})`],
    ['public.classroom_archive_revisions', `r.classroom_id in (${classes})`],
    ['public.gradebook_categories', `r.classroom_id in (${classes})`],
    ['public.classroom_enrollments', `r.id in (${ids(f.enrollments.map(e => e.id))})`],
    ['public.assignments', `r.classroom_id in (${classes})`],
    ['public.assignment_docs', `r.assignment_id in (${assignments})`],
    ['public.assignment_doc_history', `r.assignment_doc_id in (${docs})`],
    ['public.assignment_doc_save_operations', `r.assignment_doc_id in (${docs})`],
    ['public.assignment_submission_requirements', `r.assignment_id in (${assignments})`],
    ['public.assignment_submission_artifacts', `r.assignment_doc_id in (${docs})`],
    ['public.assignment_feedback_entries', `r.assignment_id in (${assignments})`],
    ['public.assignment_repo_targets', `r.assignment_id in (${assignments})`],
    ['private.pal_membership_generations', `r.generation_id in (${ids(f.enrollments.map(e => e.id))})`],
  ]
}

export function cleanupSql(f: Fixture, baseline: unknown, captured: Record<string, unknown>) {
  const tables = ownedTables(f), users = ids(f.people.map(p => p.id)), classes = ids(f.classes.map(c => c.id))
  const snapshots = tables.map(([table, predicate]) => `insert into proof_rows select ${q(table)},to_jsonb(r) from ${table} r where ${predicate};`).join('\n')
  const locks = tables.map(([table, predicate]) => `select 1 from ${table} r where ${predicate} order by to_jsonb(r)::text FOR UPDATE NOWAIT;`).join('\n')
  const people = f.people.map(p => `(${q(p.id)}::uuid,${q(p.email)},${q(p.role)})`).join(',')
  const classValues = f.classes.map(c => `(${q(c.id)}::uuid,${q(c.title)},${q(c.code)})`).join(',')
  const generationValues = f.enrollments.map(e => {
    const row = captured[e.id] as { pal_reference?: unknown } | undefined
    const ref = row && typeof row.pal_reference === 'string' && /^pika-membership-v1-[a-f0-9]{32}$/.test(row.pal_reference) ? q(row.pal_reference) : 'null::text'
    return `(${q(e.id)}::uuid,${q(e.classroom)}::uuid,${q(e.student)}::uuid,${ref})`
  }).join(',')
  const remove = (table: string) => `delete from ${table} r using proof_rows s where s.tbl=${q(table)} and to_jsonb(r)=s.row;`
  // Save-operation and audit rows have no cascading parent FK. Everything else
  // is removed by the verified parent closure, avoiding child-trigger revision
  // changes before the exact parent snapshot comparison.
  const children = ['public.assignment_doc_save_operations', 'public.effective_feature_entitlement_audit', 'public.account_plan_audit']
  return `begin;
    -- Operation locks and candidate NOWAIT locks precede every snapshot, scan and delete.
    do $operations$ declare c uuid;begin for c in select id from (values ${f.classes.map(c => `(${q(c.id)}::uuid)`).join(',')}) f(id) order by id loop
      if not public.classroom_purge_try_lock(c) then raise exception 'Synthetic cleanup operation contended';end if;
    end loop;end;$operations$;
    lock table private.pal_membership_generations in access exclusive mode nowait;
    ${locks}
    ${scanSql(f)}
    create temp table proof_rows(tbl text,row jsonb,primary key(tbl,row)) on commit drop;
    ${snapshots}
    -- Include ALL generated child identities and audit operation IDs. The global
    -- whole-row scan refuses a foreign reference even when it has no declared FK.
    insert into proof_ids select distinct v.value from proof_rows s cross join lateral jsonb_each_text(s.row) v
      where v.value ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
        or v.key in ('pal_reference','scope_digest') on conflict do nothing;
    do $closure$ declare t record;bad boolean;begin
      if ${guardSql} is distinct from 'O' then raise exception 'Guard168 changed';end if;
      for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where c.relkind in ('r','p') and n.nspname in ('public','private','storage') loop
        execute format('select exists(select 1 from %I.%I r where exists(select 1 from proof_ids f where position(f.id in to_jsonb(r)::text)>0) and not exists(select 1 from proof_rows s where s.tbl=%L and s.row=to_jsonb(r)))',t.nspname,t.relname,t.nspname||'.'||t.relname) into bad;
        if bad then raise exception 'Unexpected dependency or foreign fixture reference';end if;
      end loop;
      if exists(select 1 from public.users u join (values ${people}) f(id,email,role) on u.id=f.id where u.email is distinct from f.email or u.role is distinct from f.role)
        or exists(select 1 from public.classrooms c join (values ${classValues}) f(id,title,code) on c.id=f.id where c.title is distinct from f.title or c.class_code is distinct from f.code or c.teacher_id not in (${users}))
        or exists(select 1 from public.assignments a where a.classroom_id in (${classes}) and (a.created_by not in (${users}) or position(${q(f.tag)} in a.title)<>1))
        or exists(select 1 from proof_rows s where s.tbl in ('public.assignment_docs','public.assignment_submission_artifacts','public.assignment_feedback_entries','public.assignment_repo_targets') and s.row->>'student_id' not in (${users}))
        or exists(select 1 from proof_rows s where s.tbl='public.assignment_feedback_entries' and (s.row->>'author_type'<>'teacher' or s.row->>'created_by' not in (${users})))
        then raise exception 'Fixture ownership identity changed';end if;
      if exists(select 1 from private.pal_membership_generations g join (values ${generationValues}) f(id,c,u,ref) on g.generation_id=f.id
        where g.scope_digest is distinct from private.pal_membership_scope(f.c,f.u) or g.pal_reference !~ '^pika-membership-v1-[a-f0-9]{32}$'
          or (f.ref is not null and g.pal_reference is distinct from f.ref) or g.state not in ('active','removed'))
        then raise exception 'Synthetic generation binding changed';end if;
      if exists(select 1 from public.classroom_enrollments e where e.id in (${ids(f.enrollments.map(e => e.id))})
        and not exists(select 1 from (values ${f.enrollments.map(e => `(${q(e.id)}::uuid,${q(e.classroom)}::uuid,${q(e.student)}::uuid)`).join(',')}) f(id,c,u)
          where f.id=e.id and f.c=e.classroom_id and f.u=e.student_id)) then raise exception 'Enrollment binding changed';end if;
    end;$closure$;
    -- Exact three untouched default categories for every created Classroom.
    do $categories$ begin
      if (select count(*) from public.gradebook_categories where classroom_id in (${classes}))<>3*(select count(*) from public.classrooms where id in (${classes}))
        or exists(select 1 from public.classrooms c cross join (values ('Attendance'::text,10::numeric,10,0,false),('Term',65::numeric,10,1,true),('Final',25::numeric,10,2,false)) d(name,percentage,weight,position,is_default)
          left join public.gradebook_categories g on g.classroom_id=c.id and g.name=d.name
          where c.id in (${classes}) and (g.id is null or g.percentage is distinct from d.percentage or g.default_assessment_weight is distinct from d.weight
            or g.position is distinct from d.position or g.is_default is distinct from d.is_default or g.created_at is distinct from c.created_at or g.updated_at is distinct from g.created_at))
        then raise exception 'Unexpected default gradebook categories';end if;
    end;$categories$;
    -- Auto-Free provisioning is permitted only as exact subject/operation pairs;
    -- manual setup grants also bind their preallocated operation and run tag.
    create temp table proof_provision_ops(operation_id uuid,subject_user_id uuid,primary key(operation_id,subject_user_id)) on commit drop;
    insert into proof_provision_ops select operation_id,subject_user_id from public.account_plan_audit
      where subject_user_id in (${users}) and actor_ref='system:user-provisioning' and reason_code='default_free_account_provisioning'
        and previous_plan_key is null and new_plan_key='free' and new_classroom_limit=0 and plan_revision=1 and entitlement_revision=1;
    do $audits$ begin
      if exists(select 1 from public.account_plan_audit a where a.subject_user_id in (${users}) and not exists(select 1 from proof_provision_ops p where p.operation_id=a.operation_id and p.subject_user_id=a.subject_user_id))
        or exists(select 1 from public.effective_feature_entitlement_audit a where a.subject_user_id in (${users}) and not (
          exists(select 1 from proof_provision_ops p where p.operation_id=a.operation_id and p.subject_user_id=a.subject_user_id
            and a.actor_ref='system:user-provisioning' and a.reason_code='default_free_account_provisioning' and a.feature_key='classrooms.create'
            and a.new_source='plan' and not a.new_enabled and a.new_quota_limit=0 and a.entitlement_revision=1)
          or exists(select 1 from (values ${f.grants.map(g => `(${q(g.operation)}::uuid,${q(g.subject)}::uuid)`).join(',')}) f(op,u)
            where a.operation_id=f.op and a.subject_user_id=f.u and a.actor_ref='test:shared-assignment-writes' and a.reason_code=${q(f.tag)}
              and a.feature_key='classrooms.create' and a.new_source='manual' and a.new_enabled and a.new_quota_limit=3)))
        then raise exception 'Unexpected provisioning or grant audit';end if;
      if exists(select 1 from public.account_plans where subject_user_id in (${users}) and (plan_key<>'free' or revision<>1))
        or exists(select 1 from proof_provision_ops group by subject_user_id having count(*)<>1)
        then raise exception 'Unexpected plan state';end if;
    end;$audits$;
    ${children.map(remove).join('\n')}
    ${remove('public.classrooms')}
    ${remove('public.users')}
    -- Enrollment deletion can only retire the exact fixture generation. Every
    -- remaining identity/scope/reference field must equal its locked snapshot.
    do $generation$ begin
      if exists(select 1 from proof_rows s left join private.pal_membership_generations g on g.generation_id=(s.row->>'generation_id')::uuid
        where s.tbl='private.pal_membership_generations' and (g.generation_id is null or (to_jsonb(g)-'state') is distinct from (s.row-'state')
          or not (g.state=s.row->>'state' or (s.row->>'state'='active' and g.state='removed')))) then raise exception 'Generation cleanup transition differs';end if;
    end;$generation$;
    update proof_rows s set row=to_jsonb(g) from private.pal_membership_generations g where s.tbl='private.pal_membership_generations' and g.generation_id=(s.row->>'generation_id')::uuid;
    -- Fixture-only168 suppression is contained in this locked transaction; any
    -- error rolls back both cleanup mutations and trigger state.
    alter table private.pal_membership_generations disable trigger guard_pal_membership_evidence;
    ${remove('private.pal_membership_generations')}
    alter table private.pal_membership_generations enable trigger guard_pal_membership_evidence;
    ${fingerprintSql()}
    do $complete$ begin
      if ${guardSql} is distinct from 'O' then raise exception 'Guard168 not restored';end if;
      if pg_temp.shared_write_residue()<>'{}'::jsonb then raise exception 'Synthetic residue remains';end if;
      if pg_temp.shared_write_fingerprint() is distinct from ${q(JSON.stringify(baseline))}::jsonb then raise exception 'Whole-row global baseline differs before commit';end if;
    end;$complete$;commit;`
}

export function databaseProof(f: Fixture) {
  const appName = `${f.tag}_sql`
  const sql = (statement: string) => command('docker', ['exec', '-i', '-e', `PGAPPNAME=${appName}`, 'supabase_db_pika',
    'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt', '-v', 'ON_ERROR_STOP=1'],
  `set statement_timeout='45s';set lock_timeout='4s';${statement}`)
  const fingerprint = () => JSON.parse(sql(`${fingerprintSql()}select pg_temp.shared_write_fingerprint();`)) as unknown
  const residue = () => JSON.parse(sql(`begin;${scanSql(f)}select pg_temp.shared_write_residue();rollback;`)) as unknown
  return {
    sql, fingerprint,
    async cleanup(baseline: unknown, captured: Record<string, unknown>) {
      // A command timeout can leave a backend: terminate only this run's exact
      // application name before attempting guarded cleanup, never other sessions.
      command('docker', ['exec', '-i', 'supabase_db_pika', 'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt', '-v', 'ON_ERROR_STOP=1'],
        `set statement_timeout='5s';select pg_terminate_backend(pid) from pg_stat_activity where application_name=${q(appName)} and usename='postgres' and datname='postgres' and pid<>pg_backend_pid();`)
      sql(cleanupSql(f, baseline, captured))
      same(residue(), {}, 'Synthetic residual state after commit')
      demand(sql(`select ${guardSql};`) === 'O', 'Guard168 differs after commit')
      same(fingerprint(), baseline, 'Whole-row global baseline differs after cleanup')
      process.stdout.write(`${CLEANUP_PASS}\n`)
    },
    prepare() {
      demand(sql(`select ${guardSql};`) === 'O', 'Guard168 original state must be O')
      //169 capture triggers consult persisted state, independently of PAL_*.
      // Read and refuse an enabled installation; never toggle its settings.
      demand(sql('select not private.pal_classroom_signals_enabled();') === 't', 'Persisted Pal classroom capture must be OFF')
      demand(sql('select not coalesce((select enabled from private.pal_classroom_signal_settings where singleton),false);') === 't', 'Scheduled Pal classroom capture must be OFF')
      same(residue(), {}, 'Preallocated identities or tag already exist')
      return fingerprint()
    },
    setup() {
      sql(`begin;
        select 1 from private.pal_classroom_signal_settings where singleton for share nowait;
        select 1 from private.pal_membership_settings where singleton for share nowait;
        do $provider_guard$ begin if private.pal_classroom_signals_enabled() then raise exception 'Persisted Pal capture enabled';end if;end;$provider_guard$;
        insert into public.users(id,email,role) values ${f.people.map(p => `(${q(p.id)},${q(p.email)},${q(p.role)})`).join(',')};
        select public.set_effective_feature_entitlement_v1(op,u,'classrooms.create','manual',true,clock_timestamp(),null,3,'test:shared-assignment-writes',${q(f.tag)},
          coalesce((select revision from public.effective_feature_entitlements where subject_user_id=u and feature_key='classrooms.create'),0))
          from (values ${f.grants.map(g => `(${q(g.operation)}::uuid,${q(g.subject)}::uuid)`).join(',')}) f(op,u);
        insert into public.classrooms(id,teacher_id,title,class_code) values ${f.classes.map(c => `(${q(c.id)},${q(c.owner)},${q(c.title)},${q(c.code)})`).join(',')};
        insert into public.classroom_enrollments(id,classroom_id,student_id) values ${f.enrollments.map(e => `(${q(e.id)},${q(e.classroom)},${q(e.student)})`).join(',')};commit;`)
    },
    capture() {
      return JSON.parse(sql(`select coalesce(jsonb_object_agg(generation_id::text,to_jsonb(g)),'{}') from private.pal_membership_generations g where generation_id in (${ids(f.enrollments.map(e => e.id))});`)) as Record<string, unknown>
    },
  }
}
