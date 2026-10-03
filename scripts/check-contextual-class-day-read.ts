// Local-only installed-SDK proof for dormant shared class-day GETs.
// Root runs this serially against the exact local Pika project; it never
// applies a migration, invokes a calendar write RPC, or changes rollout flags.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { readContextualClassDays } from '../src/lib/server/contextual-class-day-read'
import type { Database } from '../src/types/database'

type WireRow = Record<string, unknown>
type Mode = 'owner' | 'member'

async function main() {
  const container = 'supabase_db_pika'
  assert.equal(execFileSync('docker', ['inspect', container, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}'],
    { encoding: 'utf8' }).trim(), 'pika')
  assert.match(execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }), /:54322\s*$/m)
  let status: { API_URL: string; SERVICE_ROLE_KEY: string }
  try {
    status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  } catch {
    throw new Error('Local Supabase status is unavailable')
  }
  assert.equal(status.API_URL, 'http://127.0.0.1:54321')
  assert.equal(typeof status.SERVICE_ROLE_KEY, 'string')
  assert(status.SERVICE_ROLE_KEY.length > 20)

  function sql(statement: string) {
    return execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt',
      '-v', 'ON_ERROR_STOP=1'], {
      input: `set statement_timeout='90s'; set lock_timeout='5s'; ${statement}`,
      encoding: 'utf8', timeout: 100_000, maxBuffer: 5_000_000,
    }).trim()
  }
  assert.equal(sql("select exists(select 1 from supabase_migrations.schema_migrations where version='234');"), 't',
    'Reviewed local migration 234 must be installed')
  function state() {
    return JSON.parse(sql(`select jsonb_build_object(
      'users',(select count(*) from public.users),
      'classrooms',(select count(*) from public.classrooms),
      'class_days',(select count(*) from public.class_days),
      'enrollments',(select count(*) from public.classroom_enrollments),
      'roster',(select count(*) from public.classroom_roster),
      'bindings',(select count(*) from public.classroom_roster_student_bindings),
      'profiles',(select count(*) from public.student_profiles),
      'archives',(select count(*) from public.classroom_archive_revisions),
      'plans',(select count(*) from public.account_plans),
      'plan_audit',(select count(*) from public.account_plan_audit),
      'entitlements',(select count(*) from public.effective_feature_entitlements),
      'entitlement_audit',(select count(*) from public.effective_feature_entitlement_audit));`)) as Record<string, number>
  }
  const baseline = state()
  const tag = `dayread_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  const users = [
    { label: 'owner_student', role: 'student' },
    { label: 'owner_teacher', role: 'teacher' },
    { label: 'member_student', role: 'student' },
    { label: 'member_teacher', role: 'teacher' },
    { label: 'outsider', role: 'teacher' },
  ].map(user => ({ ...user, id: randomUUID(), email: `${tag}_${user.label}@example.invalid` }))
  const person = (label: string) => {
    const user = users.find(item => item.label === label)
    assert(user)
    return user
  }
  const ownerStudent = person('owner_student').id
  const ownerTeacher = person('owner_teacher').id
  const memberStudent = person('member_student').id
  const memberTeacher = person('member_teacher').id
  const outsider = person('outsider').id
  const classA = randomUUID(), classB = randomUUID(), emptyClass = randomUUID(), deletableClass = randomUUID()
  const classes = [
    { id: classA, owner: ownerStudent, label: 'A' },
    { id: classB, owner: ownerTeacher, label: 'B' },
    { id: emptyClass, owner: ownerStudent, label: 'empty' },
    { id: deletableClass, owner: ownerTeacher, label: 'deletable' },
  ]
  const classIds = classes.map(item => `'${item.id}'::uuid`).join(',')
  const userIds = users.map(item => `'${item.id}'::uuid`).join(',')
  const identities = users.map(item => `('${item.id}'::uuid,'${item.email}')`).join(',')
  const entitlementOps = [ownerStudent, ownerTeacher].map(id => ({ id, operation: randomUUID() }))
  const operationValues = entitlementOps.map(item => `('${item.operation}'::uuid,'${item.id}'::uuid)`).join(',')
  const dayB = [randomUUID(), randomUUID(), randomUUID()]
  const deletableDay = randomUUID()
  const service = createClient<Database>(status.API_URL, status.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const read = (actorId: string, classroomId: string, supabase = service) =>
    readContextualClassDays({ supabase, actorId, classroomId })

  type TraceOptions = {
    pageSize?: number
    beforePage?: number
    change?: () => void
    schemaErrorAt?: number
    tamper?: (page: number, body: unknown[], root: WireRow, firstDay: WireRow | null) => void
  }
  function trace(actorId: string, classroomId: string, mode: Mode, options: TraceOptions = {}) {
    let pages = 0
    let preflights = 0
    let firstDay: WireRow | null = null
    const cursors: Array<string | null> = []
    const client = createClient<Database>(status.API_URL, status.SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        assert.equal(url.origin, 'http://127.0.0.1:54321')
        if (url.pathname === '/rest/v1/classroom_enrollments') {
          assert.equal(mode, 'member', 'Only member preflight may query enrollments directly')
          preflights++
          assert.equal(preflights, 2, 'Classroom preflight precedes membership preflight')
          assert.equal(url.searchParams.get('select'), 'classroom_id,student_id')
          assert.equal(url.searchParams.get('classroom_id'), `eq.${classroomId}`)
          assert.equal(url.searchParams.get('student_id'), `eq.${actorId}`)
          return fetch(url, init)
        }
        assert.equal(url.pathname, '/rest/v1/classrooms', 'No unbound class-day payload or RPC/fallback')
        assert.equal(url.searchParams.get('id'), `eq.${classroomId}`)
        const select = url.searchParams.get('select') ?? ''
        if (!select.includes('class_days:')) {
          preflights++
          assert.equal(preflights, 1, 'Exactly one classroom preflight')
          assert.equal(select, 'id,teacher_id,archived_at')
          return fetch(url, init)
        }
        pages++
        assert(pages <= 15, 'Bounded keyset scan without retry/fallback')
        assert.match(select, /class_days:class_days!class_days_classroom_id_fkey\(id,classroom_id,date,is_class_day,prompt_text\)/)
        assert.equal(url.searchParams.get('class_days.order'), 'date.asc,id.asc')
        assert.equal(url.searchParams.get('class_days.limit'), '1000')
        assert.equal(url.searchParams.get('id'), `eq.${classroomId}`)
        if (mode === 'owner') {
          assert.equal(url.searchParams.get('teacher_id'), `eq.${actorId}`)
          assert(!select.includes('membership:'))
        } else {
          assert.equal(url.searchParams.get('teacher_id'), `neq.${actorId}`)
          assert.equal(url.searchParams.get('archived_at'), 'is.null')
          assert.match(select, /membership:classroom_enrollments!classroom_enrollments_classroom_id_fkey!inner\(classroom_id,student_id\)/)
          assert.equal(url.searchParams.get('membership.student_id'), `eq.${actorId}`)
        }
        const cursor = url.searchParams.get('class_days.or')
        cursors.push(cursor)
        if (pages === 1) assert.equal(cursor, null)
        else {
          assert.match(cursor ?? '', /^\(date\.gt\.\d{4}-\d\d-\d\d,and\(date\.eq\.\d{4}-\d\d-\d\d,id\.gt\.[0-9a-f-]{36}\)\)$/)
          assert(!url.searchParams.has('class_days.offset'), 'No offset pagination')
        }
        if (pages === options.beforePage) options.change?.()
        if (options.pageSize !== undefined) url.searchParams.set('class_days.limit', String(options.pageSize))
        if (pages === options.schemaErrorAt) {
          return new Response(JSON.stringify({ code: 'PGRST205', message: 'Synthetic missing class-days schema' }), {
            status: 404, headers: { 'content-type': 'application/json' },
          })
        }
        const response = await fetch(url, init)
        if (!response.ok) return response
        // maybeSingle converts the genuine GET wire array after this fetch seam.
        const body: unknown = await response.json()
        assert(Array.isArray(body), 'PostgREST GET must emit an array')
        const root = body[0] as WireRow | undefined
        if (root && Array.isArray(root.class_days) && root.class_days.length && !firstDay) {
          firstDay = { ...(root.class_days[0] as WireRow) }
        }
        if (root && options.tamper) options.tamper(pages, body, root, firstDay)
        const headers = new Headers(response.headers)
        headers.delete('content-length')
        return new Response(JSON.stringify(body), { status: response.status, headers })
      } },
    })
    return { client, pages: () => pages, preflights: () => preflights, cursors }
  }

  function resetB() {
    sql(`update public.classrooms set teacher_id='${ownerTeacher}',archived_at=null where id='${classB}';
      insert into public.classroom_enrollments(classroom_id,student_id)
        values('${classB}','${memberStudent}'),('${classB}','${memberTeacher}') on conflict do nothing;`)
  }
  function recreateDisposable() {
    sql(`insert into public.classrooms(id,teacher_id,title,class_code)
      values('${deletableClass}','${ownerTeacher}','${tag} deletable','${tag}_deletable');
      insert into public.classroom_enrollments(classroom_id,student_id) values('${deletableClass}','${memberStudent}');
      insert into public.class_days(id,classroom_id,date,is_class_day,prompt_text)
        values('${deletableDay}','${deletableClass}','2031-01-01',true,'Disposable day');`)
  }

  try {
    sql(`begin;
      insert into public.users(id,email,role) values
        ${users.map(item => `('${item.id}','${item.email}','${item.role}')`).join(',')};
      set local role service_role;
      select public.set_effective_feature_entitlement_v1(operation_id,u,'classrooms.create','manual',true,
        clock_timestamp(),null,4,'test:contextual-class-day-read','${tag}',
        coalesce((select revision from public.effective_feature_entitlements
          where subject_user_id=u and feature_key='classrooms.create'),0))
        from (values ${operationValues}) fixture(operation_id,u);
      reset role;
      insert into public.classrooms(id,teacher_id,title,class_code) values
        ${classes.map(item => `('${item.id}','${item.owner}','${tag} ${item.label}','${tag}_${item.label}')`).join(',')};
      insert into public.classroom_enrollments(classroom_id,student_id) values
        ('${classA}','${ownerStudent}'),('${classA}','${memberStudent}'),('${classA}','${memberTeacher}'),
        ('${classB}','${memberStudent}'),('${classB}','${memberTeacher}'),
        ('${emptyClass}','${memberTeacher}'),
        ('${deletableClass}','${memberStudent}');
      insert into public.class_days(classroom_id,date,is_class_day,prompt_text)
        select '${classA}'::uuid,date '2020-01-01'+n,(n%7<>0),
          case when n=0 then 'Opening prompt' when n=1004 then 'Final prompt' else null end
        from generate_series(0,1004) n;
      insert into public.class_days(id,classroom_id,date,is_class_day,prompt_text) values
        ('${dayB[0]}','${classB}','2030-01-01',true,'First B'),
        ('${dayB[1]}','${classB}','2030-01-02',false,null),
        ('${dayB[2]}','${classB}','2030-01-03',true,'Last B'),
        ('${deletableDay}','${deletableClass}','2031-01-01',true,'Disposable day');
      commit;`)
    if (process.argv.includes('--verify-cleanup-after-fixture')) throw new Error('Forced post-fixture cleanup proof')

    const ownerTrace = trace(ownerStudent, classA, 'owner')
    const owner = await read(ownerStudent, classA, ownerTrace.client)
    assert.deepEqual(Object.keys(owner), ['class_days'])
    assert.equal(owner.class_days.length, 1005)
    assert.equal(ownerTrace.preflights(), 1, 'An enrolled owner takes owner precedence')
    assert.equal(ownerTrace.pages(), 3, '1005 days require two data pages and terminal empty page')
    assert.deepEqual(Object.keys(owner.class_days[0]).sort(),
      ['id', 'classroom_id', 'date', 'is_class_day', 'prompt_text'].sort())
    assert.equal(owner.class_days[0].date, '2020-01-01')
    assert.equal(owner.class_days[0].is_class_day, false)
    assert.equal(owner.class_days[0].prompt_text, 'Opening prompt')
    assert.equal(owner.class_days.at(-1)?.prompt_text, 'Final prompt')
    assert.equal(new Set(owner.class_days.map(row => row.id)).size, 1005)
    assert.equal(new Set(owner.class_days.map(row => row.date)).size, 1005)
    assert(owner.class_days.every(row => row.classroom_id === classA))
    for (let index = 1; index < owner.class_days.length; index++) {
      assert(owner.class_days[index - 1].date < owner.class_days[index].date)
    }
    const teacherMember = await read(memberTeacher, classA)
    assert.deepEqual(teacherMember.class_days, owner.class_days,
      'Teacher-valued member sees complete days of student-valued owner')
    assert.equal((await read(memberStudent, classA)).class_days.length, 1005)
    assert.deepEqual((await read(ownerTeacher, classB)).class_days.map(row => row.id), dayB)
    assert.deepEqual((await read(memberStudent, classB)).class_days.map(row => row.id), dayB)
    assert.deepEqual((await read(memberTeacher, classB)).class_days.map(row => row.id), dayB)
    assert.deepEqual(await read(ownerStudent, emptyClass), { class_days: [] })
    assert.deepEqual(await read(memberTeacher, emptyClass), { class_days: [] })
    await assert.rejects(read(outsider, classA), { statusCode: 403 })
    await assert.rejects(read(ownerTeacher, classA), { statusCode: 403 })
    await assert.rejects(read(ownerStudent, randomUUID()), { statusCode: 404 })
    sql(`update public.classrooms set archived_at=clock_timestamp() where id='${classB}';`)
    assert.equal((await read(ownerTeacher, classB)).class_days.length, 3)
    await assert.rejects(read(memberStudent, classB), { statusCode: 403 })
    resetB()
    sql(`delete from public.classroom_enrollments where classroom_id='${classB}' and student_id='${memberStudent}';`)
    await assert.rejects(read(memberStudent, classB), { statusCode: 403 })
    resetB()
    process.stdout.write('PASS live SDK 1005-day pagination/projection, both global-role owners and members, archive, empty, outsider and removed membership\n')

    const shortOwner = trace(ownerTeacher, classB, 'owner', { pageSize: 1 })
    assert.deepEqual((await read(ownerTeacher, classB, shortOwner.client)).class_days.map(row => row.id), dayB)
    assert.equal(shortOwner.pages(), 4)
    assert(shortOwner.cursors.slice(1).every(cursor => cursor?.includes('date.gt.')))
    const shortMember = trace(memberStudent, classB, 'member', { pageSize: 1 })
    assert.deepEqual((await read(memberStudent, classB, shortMember.client)).class_days.map(row => row.id), dayB)
    assert.equal(shortMember.pages(), 4)
    assert.equal(shortMember.preflights(), 2)

    for (const page of [1, 2, 4]) {
      const transferred = trace(ownerTeacher, classB, 'owner', { pageSize: 1, beforePage: page,
        change: () => { sql(`update public.classrooms set teacher_id='${outsider}' where id='${classB}';`) },
      })
      await assert.rejects(read(ownerTeacher, classB, transferred.client), { statusCode: 403 })
      assert.equal(transferred.pages(), page)
      resetB()
      for (const change of [
        () => { sql(`delete from public.classroom_enrollments where classroom_id='${classB}' and student_id='${memberStudent}';`) },
        () => { sql(`update public.classrooms set archived_at=clock_timestamp() where id='${classB}';`) },
        () => { sql(`update public.classrooms set teacher_id='${memberStudent}' where id='${classB}';`) },
      ]) {
        const revoked = trace(memberStudent, classB, 'member', { pageSize: 1, beforePage: page, change })
        await assert.rejects(read(memberStudent, classB, revoked.client), { statusCode: 403 })
        assert.equal(revoked.pages(), page)
        resetB()
      }
    }
    for (const mode of ['owner', 'member'] as const) {
      const actor = mode === 'owner' ? ownerTeacher : memberStudent
      const missingSchema = trace(actor, classB, mode, { pageSize: 1, schemaErrorAt: 2 })
      await assert.rejects(read(actor, classB, missingSchema.client), { statusCode: 503 })
      assert.equal(missingSchema.pages(), 2)
    }
    process.stdout.write('PASS short date/UUID cursors, transfer/removal/archive before first/later/terminal pages and SDK error no-fallback\n')

    const mutations: Array<(page: number, body: unknown[], root: WireRow, firstDay: WireRow | null) => void> = [
      (page, _body, root) => { if (page === 2) root.class_days = null },
      (page, _body, root) => { if (page === 2) root.id = classA },
      (page, _body, root) => { if (page === 2) root.teacher_id = ownerStudent },
      (page, _body, root, firstDay) => {
        if (page === 2) (root.class_days as WireRow[])[0].id = firstDay?.id
      },
      (page, _body, root) => { if (page === 2) (root.class_days as WireRow[])[0].date = '2029-12-31' },
      (page, _body, root) => { if (page === 2) (root.class_days as WireRow[])[0].classroom_id = classA },
      (page, _body, root) => { if (page === 2) (root.class_days as WireRow[])[0].is_class_day = 'true' },
      (page, _body, root) => { if (page === 2) (root.class_days as WireRow[])[0].extra = 'private' },
      (page, body) => { if (page === 2) body.push({ id: classB }) },
    ]
    for (const tamper of mutations) {
      const corrupt = trace(ownerTeacher, classB, 'owner', { pageSize: 1, tamper })
      await assert.rejects(read(ownerTeacher, classB, corrupt.client), { statusCode: 503 })
    }
    for (const membership of [
      null,
      [],
      [{ classroom_id: classA, student_id: memberStudent }],
      [{ classroom_id: classB, student_id: memberStudent }, { classroom_id: classB, student_id: memberStudent }],
    ]) {
      const badMembership = trace(memberStudent, classB, 'member', { pageSize: 1, tamper: (page, _body, root) => {
        if (page === 2) root.membership = membership
      } })
      await assert.rejects(read(memberStudent, classB, badMembership.client), { statusCode: 503 })
    }
    process.stdout.write('PASS actual-array wire substitutions, duplicates, malformed days, membership and cardinality failure\n')

    for (const mode of ['owner', 'member'] as const) {
      for (const page of [1, 2]) {
        if (mode !== 'owner' || page !== 1) recreateDisposable()
        const actor = mode === 'owner' ? ownerTeacher : memberStudent
        const deleted = trace(actor, deletableClass, mode, { pageSize: 1, beforePage: page,
          change: () => { sql(`delete from public.classrooms where id='${deletableClass}';`) },
        })
        await assert.rejects(read(actor, deletableClass, deleted.client), { statusCode: 403 })
        assert.equal(deleted.pages(), page)
      }
    }
    process.stdout.write('PASS deletion before first and terminal owner/member payload\n')
  } finally {
    sql(`begin;
      create temp table day_fixture_provision_ops(operation_id uuid,subject_user_id uuid,
        primary key(operation_id,subject_user_id)) on commit drop;
      insert into day_fixture_provision_ops
        select audit.operation_id,audit.subject_user_id
        from public.account_plan_audit audit join (values ${identities}) identity(id,email)
          on identity.id=audit.subject_user_id
        join public.users fixture on fixture.id=identity.id and fixture.email=identity.email
        where audit.actor_ref='system:user-provisioning'
          and audit.reason_code='default_free_account_provisioning';
      delete from public.effective_feature_entitlement_audit audit using (values ${operationValues}) fixture(operation_id,u)
        where audit.operation_id=fixture.operation_id and audit.subject_user_id=fixture.u
          and audit.actor_ref='test:contextual-class-day-read' and audit.reason_code='${tag}'
          and audit.feature_key='classrooms.create';
      delete from public.effective_feature_entitlement_audit audit using day_fixture_provision_ops operation
        where audit.operation_id=operation.operation_id and audit.subject_user_id=operation.subject_user_id
          and audit.actor_ref='system:user-provisioning' and audit.reason_code='default_free_account_provisioning'
          and audit.feature_key='classrooms.create';
      delete from public.account_plan_audit audit using day_fixture_provision_ops operation
        where audit.operation_id=operation.operation_id and audit.subject_user_id=operation.subject_user_id
          and audit.actor_ref='system:user-provisioning' and audit.reason_code='default_free_account_provisioning';
      delete from public.classrooms fixture where fixture.id in (${classIds})
        and fixture.title like '${tag} %' and fixture.class_code like '${tag}_%';
      delete from public.users fixture using (values ${identities}) identity(id,email)
        where fixture.id=identity.id and fixture.email=identity.email;
      commit;`)
    assert.equal(sql(`select
      (select count(*) from public.users where id in (${userIds}))+
      (select count(*) from public.classrooms where id in (${classIds}))+
      (select count(*) from public.class_days where classroom_id in (${classIds}))+
      (select count(*) from public.classroom_enrollments where classroom_id in (${classIds}))+
      (select count(*) from public.classroom_roster where classroom_id in (${classIds}))+
      (select count(*) from public.classroom_roster_student_bindings where classroom_id in (${classIds}))+
      (select count(*) from public.student_profiles where user_id in (${userIds}))+
      (select count(*) from public.classroom_archive_revisions where classroom_id in (${classIds}))+
      (select count(*) from public.account_plans where subject_user_id in (${userIds}))+
      (select count(*) from public.account_plan_audit where subject_user_id in (${userIds}))+
      (select count(*) from public.effective_feature_entitlements where subject_user_id in (${userIds}))+
      (select count(*) from public.effective_feature_entitlement_audit where subject_user_id in (${userIds})
        or operation_id in (select operation_id from (values ${operationValues}) fixture(operation_id,u)));`),
    '0', 'No synthetic fixture row may remain')
    assert.deepEqual(state(), baseline, 'All relevant global table counts return to baseline')
    process.stdout.write('PASS exact synthetic class-day cleanup, zero residual rows and global baseline counts\n')
  }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
