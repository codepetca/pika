// Root-run source proof for the dormant contextual classroom-detail GETs.
// Exact local synthetic fixtures only; no migrations, provider or Storage calls.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { ApiError } from '../src/lib/api-error'
import { readContextualClassroomDetail } from '../src/lib/server/contextual-classroom-detail'
import { normalizeActualCourseSiteConfig } from '../src/lib/course-site-publishing'
import { normalizeClassroomFeatureVisibility } from '../src/lib/classroom-feature-visibility'
import type { Database } from '../src/types/database'

type Permission = 'owner' | 'member'
type WireRow = Record<string, unknown>
const container = 'supabase_db_pika'
const tag = `detailread_${randomUUID().replaceAll('-', '').slice(0, 12)}`
const people = [
  { label: 'owner_student', role: 'student' }, { label: 'owner_teacher', role: 'teacher' },
  { label: 'member_student', role: 'student' }, { label: 'member_teacher', role: 'teacher' },
  { label: 'outsider', role: 'teacher' },
].map(person => ({ ...person, id: randomUUID(), email: `${tag}_${person.label}@example.invalid` }))
function person(label: string) { const found = people.find(item => item.label === label); assert(found); return found.id }
const ownerStudent = person('owner_student'), ownerTeacher = person('owner_teacher')
const memberStudent = person('member_student'), memberTeacher = person('member_teacher'), outsider = person('outsider')
const classA = randomUUID(), classB = randomUUID(), deletableOwner = randomUUID(), deletableMember = randomUUID()
const classes = [
  { id: classA, owner: ownerStudent, label: 'A' }, { id: classB, owner: ownerTeacher, label: 'B' },
  { id: deletableOwner, owner: ownerTeacher, label: 'delete_owner' },
  { id: deletableMember, owner: ownerTeacher, label: 'delete_member' },
]
const enrollments = [
  [classA, ownerStudent], [classA, memberStudent], [classA, memberTeacher],
  [classB, ownerTeacher], [classB, memberStudent], [classB, memberTeacher],
  [deletableOwner, memberStudent], [deletableMember, memberStudent],
].map(([classroom, student]) => ({ id: randomUUID(), classroom, student }))
const grants = [ownerStudent, ownerTeacher].map(subject => ({ subject, operation: randomUUID() }))
const q = (value: string) => `'${value.replaceAll("'", "''")}'`
const ids = (values: readonly string[]) => values.map(q).join(',')
const userIds = people.map(item => item.id), classIds = classes.map(item => item.id), generationIds = enrollments.map(item => item.id)
const peopleValues = people.map(item => `(${q(item.id)}::uuid,${q(item.email)})`).join(',')
const grantValues = grants.map(item => `(${q(item.operation)}::uuid,${q(item.subject)}::uuid)`).join(',')
const forcedAfterFixture = 'Forced classroom detail post-fixture cleanup proof'
const forcedBeforeCapture = 'Forced classroom detail post-commit pre-capture cleanup proof'
const persistedFields = [
  'actual_site_config', 'actual_site_published', 'actual_site_slug', 'allow_enrollment', 'archived_at',
  'authoring_guidance_version_id', 'blueprint_source_revision', 'class_code', 'course_outline_markdown',
  'course_overview_markdown', 'created_at', 'end_date', 'feature_visibility', 'id', 'join_policy',
  'lesson_plan_visibility', 'manual_attendance_revision', 'manual_attendance_session_ends_local',
  'manual_attendance_session_starts_local', 'manual_attendance_source_mode', 'position', 'source_blueprint_id',
  'source_blueprint_origin', 'source_blueprint_version_id', 'start_date', 'teacher_id', 'term_label',
  'theme_color', 'title', 'updated_at',
].sort()
let capturedGenerations: Record<string, unknown> = {}

function command(binary: string, args: string[], input?: string): string {
  try {
    return execFileSync(binary, args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 55_000, maxBuffer: 8_000_000 }).trim()
  } catch { throw new Error('Local classroom detail command failed') }
}
function sql(statement: string) {
  return command('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt', '-v', 'ON_ERROR_STOP=1'],
    `set statement_timeout='50s';set lock_timeout='4s';${statement}`)
}
// Shared trusted definition: cleanup invokes this same whole-row fingerprint
// INSIDE its transaction before COMMIT; hashes never expose source identities.
function fingerprintSql(): string {
  return `create or replace function pg_temp.detail_fingerprint() returns jsonb language plpgsql as $f$
    declare t record; result jsonb:='{}'; value jsonb;
    begin
      for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where c.relkind in ('r','p') and n.nspname in ('public','private','storage') order by n.nspname,c.relname
      loop
        execute format('select jsonb_build_object(''count'',count(*),''digest'',md5(coalesce(string_agg(md5(to_jsonb(r)::text),'''' order by md5(to_jsonb(r)::text)),''''))) from %I.%I r',t.nspname,t.relname) into value;
        result:=result||jsonb_build_object(t.nspname||'.'||t.relname,value);
      end loop;
      return result;
    end;$f$;`
}
function fingerprint(): unknown { return JSON.parse(sql(`${fingerprintSql()} select pg_temp.detail_fingerprint();`)) }
const statusIs = (status: number) => (error: unknown) => error instanceof ApiError && error.statusCode === status
function rootRow(classroom: string): WireRow {
  return z.record(z.string(), z.unknown()).parse(JSON.parse(sql(`select to_jsonb(c) from public.classrooms c where id=${q(classroom)};`)))
}
function selectedFields(select: string): string[] {
  const parts: string[] = []; let depth = 0, start = 0
  for (let i = 0; i < select.length; i++) {
    if (select[i] === '(') depth++
    if (select[i] === ')') depth--
    if (select[i] === ',' && depth === 0) { parts.push(select.slice(start, i)); start = i + 1 }
  }
  parts.push(select.slice(start)); assert.equal(depth, 0)
  return parts
}

async function main() {
  assert.equal(command('docker', ['inspect', container, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}']), 'pika')
  assert.match(command('docker', ['port', container, '5432/tcp']), /:54322\s*$/m)
  const local = z.object({ API_URL: z.literal('http://127.0.0.1:54321'), SERVICE_ROLE_KEY: z.string().min(20),
    DB_URL: z.string().refine(value => {
      try { const url = new URL(value); return ['postgres:', 'postgresql:'].includes(url.protocol)
        && ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '54322' && url.pathname === '/postgres' }
      catch { return false }
    }),
  }).safeParse(JSON.parse(command('supabase', ['status', '-o', 'json'])))
  if (!local.success) throw new Error('Local classroom detail target guard failed')
  const { API_URL, SERVICE_ROLE_KEY } = local.data
  const installed = createClient<Database>(API_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const read = (actorId: string, classroomId: string, permission: Permission, supabase = installed) =>
    readContextualClassroomDetail({ supabase, actorId, classroomId, permission })
  type TraceOptions = {
    beforePayload?: () => void
    fail?: 'preflight' | 'payload'
    transportThrow?: boolean
    preflightTamper?: (body: unknown[], root: WireRow) => void
    tamper?: (body: unknown[], root: WireRow) => void
  }
  function trace(actorId: string, classroomId: string, permission: Permission, options: TraceOptions = {}) {
    let preflights = 0, payloads = 0
    const client = createClient<Database>(API_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        assert.equal(url.origin, 'http://127.0.0.1:54321')
        assert.equal(url.pathname, '/rest/v1/classrooms', 'Only classroom preflight and actor-bound detail query')
        assert.equal(url.searchParams.get('id'), `eq.${classroomId}`)
        const select = (url.searchParams.get('select') ?? '').replaceAll(/\s/g, '')
        assert(!select.includes('*'), 'No select-star at the real SDK boundary')
        const preflight = select === 'id,teacher_id,archived_at'
        if (preflight) { preflights++; assert.equal(preflights, 1); assert.equal(payloads, 0) }
        else {
          payloads++; assert.equal(preflights, 1); assert.equal(payloads, 1, 'No payload retry/fallback')
          const topFields = selectedFields(select)
          assert.deepEqual(topFields.filter(field => !field.startsWith('membership:')).sort(), persistedFields)
          assert.equal(url.searchParams.get('teacher_id'), `${permission === 'owner' ? 'eq' : 'neq'}.${actorId}`)
          if (permission === 'member') {
            assert(topFields.includes('membership:classroom_enrollments!classroom_enrollments_classroom_id_fkey!inner(classroom_id,student_id)'))
            assert.equal(url.searchParams.get('archived_at'), 'is.null')
            assert.equal(url.searchParams.get('membership.classroom_id'), `eq.${classroomId}`)
            assert.equal(url.searchParams.get('membership.student_id'), `eq.${actorId}`)
          } else { assert.equal(topFields.length, 30); assert.equal(url.searchParams.get('archived_at'), null) }
          options.beforePayload?.()
        }
        if (options.transportThrow && !preflight) throw new Error('Synthetic transport rejection')
        if (options.fail === (preflight ? 'preflight' : 'payload')) {
          return new Response(JSON.stringify({ code: 'PGRST205', message: 'Synthetic unavailable relation' }),
            { status: 503, headers: { 'content-type': 'application/json' } })
        }
        const response = await fetch(url, init)
        if (!response.ok) return response
        const body: unknown = await response.json()
        assert(Array.isArray(body), 'Installed maybeSingle transport emits an actual root array')
        if (preflight && body.length) {
          const root = z.record(z.string(), z.unknown()).parse(body[0])
          assert.deepEqual(Object.keys(root).sort(), ['archived_at', 'id', 'teacher_id'])
          // Zod parses a clone; tampering must reach the actual response body.
          body[0] = root
          options.preflightTamper?.(body, root)
        } else if (!preflight && body.length) {
          const root = z.record(z.string(), z.unknown()).parse(body[0])
          assert.deepEqual(Object.keys(root).filter(key => key !== 'membership').sort(), persistedFields)
          if (permission === 'member') {
            assert.deepEqual(root.membership, [{ classroom_id: classroomId, student_id: actorId }], 'Actual FK nested membership array')
          }
          body[0] = root
          options.tamper?.(body, root)
        }
        const headers = new Headers(response.headers); headers.delete('content-length')
        return new Response(JSON.stringify(body), { status: response.status, headers })
      } },
    })
    return { client, preflights: () => preflights, payloads: () => payloads }
  }

  assert.equal(sql(`select tgenabled from pg_trigger where tgrelid='private.pal_membership_generations'::regclass
    and tgname='guard_pal_membership_evidence' and not tgisinternal;`), 'O')
  const baseline = fingerprint()
  assert.equal(sql(`select count(*) from private.pal_membership_generations where generation_id in (${ids(generationIds)});`), '0')
  const generationBaseline = z.object({ count: z.number().int(), digest: z.string().regex(/^[a-f0-9]{32}$/) })
    .parse(z.record(z.string(), z.unknown()).parse(baseline)['private.pal_membership_generations'])
  try {
    sql(`begin;
      insert into public.users(id,email,role) values ${people.map(item => `(${q(item.id)},${q(item.email)},${q(item.role)})`).join(',')};
      set local role service_role;
      select public.set_effective_feature_entitlement_v1(operation,u,'classrooms.create','manual',true,clock_timestamp(),null,3,
        'test:classroom-detail-read',${q(tag)},coalesce((select revision from public.effective_feature_entitlements where subject_user_id=u and feature_key='classrooms.create'),0))
        from (values ${grantValues}) f(operation,u);
      reset role;
      insert into public.classrooms(id,teacher_id,title,class_code,term_label,theme_color,join_policy,
        course_overview_markdown,course_outline_markdown,manual_attendance_source_mode,
        manual_attendance_session_starts_local,manual_attendance_session_ends_local,manual_attendance_revision,actual_site_config)
        values ${classes.map(c => `(${q(c.id)},${q(c.owner)},${q(`${tag} ${c.label}`)},${q(`${tag}_${c.label}`)},'Term 1','teal','roster',
          'Owner-only overview markdown','Owner-only outline markdown','log','09:15:00','10:30:00',7,
          '{"overview":false,"resources":false,"lesson_plan_scope":"all"}'::jsonb)`).join(',')};
      insert into public.classroom_enrollments(id,classroom_id,student_id) values
        ${enrollments.map(e => `(${q(e.id)},${q(e.classroom)},${q(e.student)})`).join(',')};
      commit;`)
    if (process.argv.includes('--verify-cleanup-after-commit-before-capture')) throw new Error(forcedBeforeCapture)
    capturedGenerations = z.record(z.string(), z.unknown()).parse(JSON.parse(sql(`select coalesce(jsonb_object_agg(generation_id::text,to_jsonb(g)),'{}')
      from private.pal_membership_generations g where generation_id in (${ids(generationIds)});`)))
    assert.equal(Object.keys(capturedGenerations).length, generationIds.length)
    if (process.argv.includes('--verify-cleanup-after-fixture')) throw new Error(forcedAfterFixture)
    const beforeReads = fingerprint()
    for (const [actor, classroom] of [[ownerStudent, classA], [ownerTeacher, classB]]) {
      const observed = trace(actor, classroom, 'owner')
      const owner = z.record(z.string(), z.unknown()).parse(await read(actor, classroom, 'owner', observed.client))
      const persisted = rootRow(classroom)
      assert.equal(observed.preflights(), 1); assert.equal(observed.payloads(), 1)
      assert.deepEqual(Object.keys(owner).sort(), persistedFields)
      for (const field of persistedFields) {
        if (field === 'actual_site_config') assert.deepEqual(owner[field], normalizeActualCourseSiteConfig(persisted[field]))
        else if (field === 'feature_visibility') assert.deepEqual(owner[field], normalizeClassroomFeatureVisibility(persisted[field]))
        else assert.deepEqual(owner[field], persisted[field])
      }
      for (const member of [memberStudent, memberTeacher]) {
        const memberTrace = trace(member, classroom, 'member')
        const record = z.record(z.string(), z.unknown()).parse(await read(member, classroom, 'member', memberTrace.client))
        assert.deepEqual(Object.keys(record).sort(), persistedFields.filter(key => key !== 'authoring_guidance_version_id'))
        assert.equal(record.course_overview_markdown, ''); assert.equal(record.course_outline_markdown, '')
        assert(!('membership' in record)); assert(!('authoring_guidance_version_id' in record))
        for (const field of ['manual_attendance_source_mode', 'manual_attendance_session_starts_local',
          'manual_attendance_session_ends_local', 'manual_attendance_revision']) assert.deepEqual(record[field], persisted[field])
        assert.deepEqual(record.actual_site_config, owner.actual_site_config)
        assert.deepEqual(record.feature_visibility, owner.feature_visibility)
        assert.equal(memberTrace.preflights(), 1); assert.equal(memberTrace.payloads(), 1)
      }
      await assert.rejects(read(actor, classroom, 'member'), statusIs(403)) // Real self-enrollment does not bypass owner precedence.
      for (const deniedActor of [memberStudent, memberTeacher, outsider]) await assert.rejects(read(deniedActor, classroom, 'owner'), statusIs(403))
      await assert.rejects(read(outsider, classroom, 'member'), statusIs(403))
    }
    assert.deepEqual(fingerprint(), beforeReads, 'Reads/tampering must not write')
    for (const permission of ['owner', 'member'] as const) {
      const actor = permission === 'owner' ? ownerStudent : memberStudent
      const mutations: Array<(body: unknown[], root: WireRow) => void> = [
        (_body, root) => { root.id = classB }, (_body, root) => { root.teacher_id = outsider },
        (_body, root) => { root.manual_attendance_revision = null }, (_body, root) => { delete root.manual_attendance_source_mode },
        (_body, root) => { root.created_at = 'infinity' }, (_body, root) => { root.unexpected = true },
        (body, root) => { body.push(structuredClone(root)) }, (_body, root) => { root.id = null },
      ]
      if (permission === 'member') mutations.push(
        (_body, root) => { root.teacher_id = actor }, (_body, root) => { root.archived_at = '2026-10-03T12:00:00Z' },
        (_body, root) => { root.membership = null }, (_body, root) => { root.membership = [] },
        (_body, root) => { root.membership = [{ classroom_id: classB, student_id: actor }] },
        (_body, root) => { root.membership = [{ classroom_id: classA, student_id: outsider }] },
        (_body, root) => { root.membership = [{ classroom_id: classA, student_id: actor }, { classroom_id: classA, student_id: actor }] },
        (_body, root) => { root.membership = { classroom_id: classA, student_id: actor } },
      )
      // A different valid owner is not intrinsically a member-read mismatch;
      // test that substitution only for owner reads, where actor identity is exact.
      if (permission === 'member') mutations.splice(1, 1)
      for (const tamper of mutations) {
        const observed = trace(actor, classA, permission, { tamper })
        await assert.rejects(read(actor, classA, permission, observed.client), statusIs(503))
        assert.equal(observed.payloads(), 1)
      }
      // Installed maybeSingle maps a one-element null array and no rows to
      // data:null. Both must deny, not return a payload or fall back.
      for (const tamper of [(body: unknown[]) => { body[0] = null }, (body: unknown[]) => { body.splice(0) }]) {
        const observed = trace(actor, classA, permission, { tamper })
        await assert.rejects(read(actor, classA, permission, observed.client), statusIs(403))
        assert.equal(observed.payloads(), 1)
      }
      for (const preflightTamper of [
        (_body: unknown[], root: WireRow) => { root.id = classB },
        (_body: unknown[], root: WireRow) => { root.teacher_id = null },
        (_body: unknown[], root: WireRow) => { root.unexpected = true },
        (body: unknown[], root: WireRow) => { body.push(structuredClone(root)) },
      ]) {
        const observed = trace(actor, classA, permission, { preflightTamper })
        await assert.rejects(read(actor, classA, permission, observed.client), statusIs(503))
        assert.equal(observed.preflights(), 1); assert.equal(observed.payloads(), 0)
      }
      for (const fail of ['preflight', 'payload'] as const) {
        const observed = trace(actor, classA, permission, { fail })
        await assert.rejects(read(actor, classA, permission, observed.client), statusIs(503))
      }
      await assert.rejects(read(actor, classA, permission, trace(actor, classA, permission, { transportThrow: true }).client), statusIs(503))
      await assert.rejects(read(actor, randomUUID(), permission), statusIs(404))
    }
    assert.deepEqual(fingerprint(), beforeReads)
    process.stdout.write('PASS classroom detail actual SDK both owner/member labels, all 30 fields, hydration/manual-attendance compatibility, genuine FK wire and tampering denial\n')
    for (const c of classes.slice(0, 2)) {
      sql(`update public.classrooms set archived_at=clock_timestamp() where id=${q(c.id)} and teacher_id=${q(c.owner)};`)
      assert.equal((await read(c.owner, c.id, 'owner')).id, c.id)
      for (const member of [memberStudent, memberTeacher]) await assert.rejects(read(member, c.id, 'member'), statusIs(403))
      sql(`update public.classrooms set archived_at=null where id=${q(c.id)} and teacher_id=${q(c.owner)};`)
      const transferred = trace(c.owner, c.id, 'owner', { beforePayload: () => sql(`update public.classrooms set teacher_id=${q(outsider)} where id=${q(c.id)} and teacher_id=${q(c.owner)};`) })
      await assert.rejects(read(c.owner, c.id, 'owner', transferred.client), statusIs(403)); assert.equal(transferred.payloads(), 1)
      sql(`update public.classrooms set teacher_id=${q(c.owner)} where id=${q(c.id)} and teacher_id=${q(outsider)};`)
    }
    for (const member of [memberStudent, memberTeacher]) {
      const archived = trace(member, classA, 'member', { beforePayload: () => sql(`update public.classrooms set archived_at=clock_timestamp() where id=${q(classA)};`) })
      await assert.rejects(read(member, classA, 'member', archived.client), statusIs(403)); assert.equal(archived.payloads(), 1)
      sql(`update public.classrooms set archived_at=null where id=${q(classA)};`)
      const selfOwner = trace(member, classA, 'member', { beforePayload: () => sql(`update public.classrooms set teacher_id=${q(member)} where id=${q(classA)};`) })
      await assert.rejects(read(member, classA, 'member', selfOwner.client), statusIs(403))
      sql(`update public.classrooms set teacher_id=${q(ownerStudent)} where id=${q(classA)} and teacher_id=${q(member)};`)
      const enrollment = enrollments.find(e => e.classroom === classA && e.student === member); assert(enrollment)
      const removed = trace(member, classA, 'member', { beforePayload: () => sql(`delete from public.classroom_enrollments where id=${q(enrollment.id)} and classroom_id=${q(classA)} and student_id=${q(member)};`) })
      await assert.rejects(read(member, classA, 'member', removed.client), statusIs(403)); assert.equal(removed.payloads(), 1)
    }
    for (const [actor, classroom, permission] of [[ownerTeacher, deletableOwner, 'owner'], [memberStudent, deletableMember, 'member']] as const) {
      const deleted = trace(actor, classroom, permission, { beforePayload: () => sql(`delete from public.classrooms where id=${q(classroom)} and teacher_id=${q(ownerTeacher)};`) })
      await assert.rejects(read(actor, classroom, permission, deleted.client), statusIs(403)); assert.equal(deleted.payloads(), 1)
    }
    process.stdout.write('PASS classroom detail real owner-transfer/member-removal/archive/self-owner/delete races after narrow preflight deny without payload leakage\n')
  } finally {
    const generationValues = enrollments.map(e => {
      const parsed = z.object({ generation_id: z.literal(e.id), pal_reference: z.string().regex(/^pika-membership-v1-[a-f0-9]{32}$/) })
        .safeParse(capturedGenerations[e.id])
      return `(${q(e.id)}::uuid,${q(e.classroom)}::uuid,${q(e.student)}::uuid,${parsed.success ? q(parsed.data.pal_reference) : 'null::text'})`
    }).join(',')
    const residual = `select (select count(*) from public.users where id in (${ids(userIds)}))+
      (select count(*) from public.classrooms where id in (${ids(classIds)}))+
      (select count(*) from public.classroom_enrollments where classroom_id in (${ids(classIds)}))+
      (select count(*) from public.classroom_roster where classroom_id in (${ids(classIds)}))+
      (select count(*) from public.classroom_roster_student_bindings where classroom_id in (${ids(classIds)}))+
      (select count(*) from public.classroom_archive_revisions where classroom_id in (${ids(classIds)}))+
      (select count(*) from public.student_profiles where user_id in (${ids(userIds)}))+
      (select count(*) from public.account_plans where subject_user_id in (${ids(userIds)}))+
      (select count(*) from public.account_plan_audit where subject_user_id in (${ids(userIds)}))+
      (select count(*) from public.effective_feature_entitlements where subject_user_id in (${ids(userIds)}))+
      (select count(*) from public.effective_feature_entitlement_audit where subject_user_id in (${ids(userIds)}))+
      (select count(*) from private.pal_membership_generations where generation_id in (${ids(generationIds)}))+
      (select count(*) from public.pal_event_outbox where student_id in (${ids(userIds)}))+
      (select count(*) from private.removed_student_cleanup_jobs where classroom_id in (${ids(classIds)}))`
    // Single cleanup attempt. All identity, residue and global full-row checks
    // occur inside the transaction, including setup-COMMIT/capture ambiguity.
    sql(`begin;
      lock table private.pal_membership_generations in access exclusive mode nowait;
      create temp table detail_generation_snapshot on commit drop as select g.* from private.pal_membership_generations g
        join (values ${generationValues}) f(id,c,u,ref) on g.generation_id=f.id;
      do $guard$ begin
        if (select tgenabled from pg_trigger where tgrelid='private.pal_membership_generations'::regclass and tgname='guard_pal_membership_evidence') is distinct from 'O' then raise exception 'Generation guard differs'; end if;
        if exists(select 1 from detail_generation_snapshot g join (values ${generationValues}) f(id,c,u,ref) on g.generation_id=f.id
          where g.scope_digest is distinct from private.pal_membership_scope(f.c,f.u) or g.state not in ('active','removed')
            or g.pal_reference !~ '^pika-membership-v1-[a-f0-9]{32}$' or (f.ref is not null and g.pal_reference is distinct from f.ref)) then raise exception 'Synthetic generation binding differs'; end if;
        if exists(select 1 from public.users u join (values ${peopleValues}) f(id,email) on u.id=f.id where u.email is distinct from f.email) then raise exception 'Synthetic user differs'; end if;
        if exists(select 1 from public.classrooms c join (values ${classes.map(c => `(${q(c.id)}::uuid,${q(`${tag} ${c.label}`)},${q(`${tag}_${c.label}`)})`).join(',')}) f(id,title,code)
          on c.id=f.id where c.title is distinct from f.title or c.class_code is distinct from f.code or c.teacher_id not in (${ids(userIds)})) then raise exception 'Synthetic class differs'; end if;
        if exists(select 1 from public.pal_event_outbox where student_id in (${ids(userIds)})) or exists(select 1 from private.removed_student_cleanup_jobs where classroom_id in (${ids(classIds)})) then raise exception 'Unexpected provider fixture state'; end if;
        if exists(select 1 from (values ${classIds.map(id => `(${q(id)}::uuid)`).join(',')}) f(id)
          where public.attendance_classroom_has_state_v1(f.id)) then raise exception 'Unexpected attendance fixture state'; end if;
      end;$guard$;
      create temp table detail_provision_ops(operation_id uuid,subject_user_id uuid,primary key(operation_id,subject_user_id)) on commit drop;
      insert into detail_provision_ops select a.operation_id,a.subject_user_id from public.account_plan_audit a
        join (values ${peopleValues}) f(id,email) on f.id=a.subject_user_id join public.users u on u.id=f.id and u.email=f.email
        where a.actor_ref='system:user-provisioning' and a.reason_code='default_free_account_provisioning';
      delete from public.effective_feature_entitlement_audit a using (values ${grantValues}) f(op,u) where a.operation_id=f.op and a.subject_user_id=f.u
        and a.actor_ref='test:classroom-detail-read' and a.reason_code=${q(tag)} and a.feature_key='classrooms.create';
      delete from public.effective_feature_entitlement_audit a using detail_provision_ops p where a.operation_id=p.operation_id and a.subject_user_id=p.subject_user_id
        and a.actor_ref='system:user-provisioning' and a.reason_code='default_free_account_provisioning';
      delete from public.account_plan_audit a using detail_provision_ops p where a.operation_id=p.operation_id and a.subject_user_id=p.subject_user_id
        and a.actor_ref='system:user-provisioning' and a.reason_code='default_free_account_provisioning';
      delete from public.classrooms c using (values ${classes.map(c => `(${q(c.id)}::uuid,${q(`${tag} ${c.label}`)},${q(`${tag}_${c.label}`)})`).join(',')}) f(id,title,code)
        where c.id=f.id and c.title=f.title and c.class_code=f.code and c.teacher_id in (${ids(userIds)});
      delete from public.users u using (values ${peopleValues}) f(id,email) where u.id=f.id and u.email=f.email;
      do $transition$ begin
        if exists(select 1 from detail_generation_snapshot s left join private.pal_membership_generations g on g.generation_id=s.generation_id
          where g.generation_id is null or (to_jsonb(g)-'state') is distinct from (to_jsonb(s)-'state')
            or not(g.state=s.state or (s.state='active' and g.state='removed'))) then raise exception 'Generation changed during cleanup'; end if;
      end;$transition$;
      update detail_generation_snapshot s set state=g.state from private.pal_membership_generations g where g.generation_id=s.generation_id;
      alter table private.pal_membership_generations disable trigger guard_pal_membership_evidence;
      delete from private.pal_membership_generations g using detail_generation_snapshot s where g.generation_id=s.generation_id and to_jsonb(g)=to_jsonb(s);
      alter table private.pal_membership_generations enable trigger guard_pal_membership_evidence;
      ${fingerprintSql()}
      do $complete$ begin
        if (select tgenabled from pg_trigger where tgrelid='private.pal_membership_generations'::regclass and tgname='guard_pal_membership_evidence') is distinct from 'O'
          or (${residual})<>0 then raise exception 'Cleanup guard/residue differs'; end if;
        if (select jsonb_build_object('count',count(*),'digest',md5(coalesce(string_agg(md5(to_jsonb(g)::text),'' order by md5(to_jsonb(g)::text)),''))) from private.pal_membership_generations g)
          is distinct from ${q(JSON.stringify(generationBaseline))}::jsonb then raise exception 'Untouched generation baseline differs'; end if;
        if pg_temp.detail_fingerprint() is distinct from ${q(JSON.stringify(baseline))}::jsonb then raise exception 'Whole-row global baseline differs'; end if;
      end;$complete$;
      commit;`)
    assert.equal(sql(`${residual};`), '0')
    assert.equal(sql(`select tgenabled from pg_trigger where tgrelid='private.pal_membership_generations'::regclass and tgname='guard_pal_membership_evidence';`), 'O')
    assert.deepEqual(fingerprint(), baseline)
    process.stdout.write('PASS exact synthetic classroom detail cleanup, zero residual rows and global baseline counts\n')
  }
}
main().catch((error: unknown) => {
  process.stderr.write(error instanceof Error && error.message === forcedAfterFixture
    ? 'FAIL Forced classroom detail post-fixture cleanup proof (expected for --verify-cleanup-after-fixture)\n'
    : error instanceof Error && error.message === forcedBeforeCapture
      ? 'FAIL Forced classroom detail post-commit pre-capture cleanup proof (expected for --verify-cleanup-after-commit-before-capture)\n'
      : 'FAIL local classroom detail SDK proof (captured command/status data withheld)\n')
  process.exitCode = 1
})
