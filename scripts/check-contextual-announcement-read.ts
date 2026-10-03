// Local-only SDK/PostgREST contract. Synthetic tagged fixtures, no schema or hosted calls.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { readContextualAnnouncements } from '../src/lib/server/contextual-announcement-read'
import type { Database } from '../src/types/database'

async function main() {
  const container = 'supabase_db_pika'
  assert.equal(execFileSync('docker', ['inspect', container, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}'], { encoding: 'utf8' }).trim(), 'pika')
  assert.match(execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }), /:54322\s*$/m)
  const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  assert.equal(status.API_URL, 'http://127.0.0.1:54321')
  assert.equal(typeof status.SERVICE_ROLE_KEY, 'string')
  const service = createClient<Database>(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  function sql(statement: string) {
    return execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt', '-v', 'ON_ERROR_STOP=1'], {
      input: `set statement_timeout='15s'; set lock_timeout='3s'; ${statement}`, encoding: 'utf8',
    }).trim()
  }
  const tag = `annread_${randomUUID().slice(0, 8)}`
  const ownerStudent = randomUUID(), ownerTeacher = randomUUID(), outsider = randomUUID()
  const memberStudent = randomUUID(), memberTeacher = randomUUID()
  const users = [
    { id: ownerStudent, label: 'owner_student', role: 'student' },
    { id: ownerTeacher, label: 'owner_teacher', role: 'teacher' },
    { id: outsider, label: 'outsider', role: 'teacher' },
    { id: memberStudent, label: 'member_student', role: 'student' },
    { id: memberTeacher, label: 'member_teacher', role: 'teacher' },
  ]
  const identities = users.map(user => `('${user.id}'::uuid,'${tag}_${user.label}@example.invalid')`).join(',')
  const userIds = users.map(user => `'${user.id}'::uuid`).join(',')
  const operations = [ownerStudent, ownerTeacher, memberTeacher].map(subject => ({ subject, operation: randomUUID() }))
  const operationsSql = operations.map(({ subject, operation }) => `('${operation}'::uuid,'${subject}'::uuid)`).join(',')
  const classA = randomUUID(), classB = randomUUID(), emptyClass = randomUUID(), hiddenClass = randomUUID()
  const classes = [classA, classB, emptyClass, hiddenClass]
  const classesSql = classes.map(id => `'${id}'::uuid`).join(',')
  const cutoff = '2026-10-02T12:00:00.123456Z'
  const forcedCleanup = process.argv.includes('--verify-cleanup-after-fixture')
  type Permission = 'owner' | 'member'
  const read = (actorId: string, classroomId: string, permission: Permission, supabase = service) =>
    readContextualAnnouncements({ supabase, actorId, classroomId, permission, now: new Date(cutoff) })
  // The injected Date has millisecond precision; use the matching SQL cutoff for the boundary fixture.
  const requestCutoff = new Date(cutoff).toISOString()
  function instrument(actorId: string, classroomId: string, permission: Permission,
    options: { beforePage?: number; mutation?: () => void; pageSize?: number } = {}) {
    let pages = 0
    const cursors: Array<string | null> = []
    const client = createClient<Database>(status.API_URL, status.SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (input, init) => {
        const url = new URL(String(input))
        assert(!url.pathname.startsWith('/rest/v1/rpc/'), 'No RPC fallback')
        assert.notEqual(url.pathname, '/rest/v1/announcements', 'No unbound announcement payload query')
        const select = url.searchParams.get('select') ?? ''
        if (url.pathname === '/rest/v1/classrooms' && select.includes('announcements:')) {
          pages++
          assert(pages < 20, 'Bounded fixture query count; no retry/fallback')
          assert.equal(url.searchParams.get('id'), `eq.${classroomId}`)
          assert.equal(url.searchParams.get('teacher_id'), `${permission === 'owner' ? 'eq' : 'neq'}.${actorId}`)
          assert.match(select, /announcements:announcements!announcements_classroom_id_fkey\(/)
          assert(!select.includes('announcements_classroom_id_fkey!inner'), 'Empty authorized lists retain the classroom root')
          assert.equal(url.searchParams.get('announcements.order'), 'published_at.desc.nullsfirst,id.asc')
          assert.equal(url.searchParams.get('announcements.limit'), '1000')
          assert.equal(url.searchParams.getAll('announcements.or').length, permission === 'member' || pages > 1 ? 1 : 0)
          if (permission === 'member') {
            assert.match(select, /membership:classroom_enrollments!classroom_enrollments_classroom_id_fkey!inner\(/)
            assert.equal(url.searchParams.get('membership.student_id'), `eq.${actorId}`)
            assert.equal(url.searchParams.get('archived_at'), 'is.null')
            assert.equal(url.searchParams.get('announcements.is_draft'), 'eq.false')
          }
          cursors.push(url.searchParams.get('announcements.or'))
          if (pages === options.beforePage) options.mutation?.()
          if (options.pageSize !== undefined) url.searchParams.set('announcements.limit', String(options.pageSize))
        }
        return fetch(url, init)
      } },
    })
    return { client, pages: () => pages, cursors }
  }
  function resetClassB() {
    sql(`update public.classrooms set teacher_id='${ownerTeacher}',archived_at=null where id='${classB}';
      insert into public.classroom_enrollments(classroom_id,student_id) values('${classB}','${memberTeacher}') on conflict do nothing;`)
  }
  try {
    sql(`begin;
      insert into public.users(id,email,role) values ${users.map(user => `('${user.id}','${tag}_${user.label}@example.invalid','${user.role}')`).join(',')};
      set local role service_role;
      select public.set_effective_feature_entitlement_v1(operation_id,u,'classrooms.create','manual',true,
        clock_timestamp(),null,4,'test:announcement-read','${tag}',
        coalesce((select revision from public.effective_feature_entitlements where subject_user_id=u and feature_key='classrooms.create'),0))
      from (values ${operationsSql}) fixture(operation_id,u);
      reset role;
      insert into public.classrooms(id,teacher_id,title,class_code) values
        ('${classA}','${ownerStudent}','${tag} A','${tag}_a'),
        ('${classB}','${ownerTeacher}','${tag} B','${tag}_b'),
        ('${emptyClass}','${ownerStudent}','${tag} empty','${tag}_empty'),
        ('${hiddenClass}','${ownerStudent}','${tag} hidden','${tag}_hidden');
      insert into public.classroom_enrollments(classroom_id,student_id)
        select c,u from unnest(array[${classesSql}]) c cross join unnest(array['${memberStudent}'::uuid,'${memberTeacher}'::uuid]) u;
      insert into public.classroom_enrollments(classroom_id,student_id) values('${classA}','${ownerStudent}');
      insert into public.announcements(classroom_id,content,created_by,is_draft,published_at)
        select '${classA}','synthetic tie '||n,'${ownerStudent}',false,'2020-01-01T00:00:00Z' from generate_series(1,1001) n;
      insert into public.announcements(classroom_id,content,created_by,is_draft,published_at,scheduled_for) values
        ('${classA}','draft one','${ownerStudent}',true,null,null),
        ('${classA}','draft two','${ownerStudent}',true,null,null),
        ('${classA}','micro later','${ownerStudent}',false,'2020-01-01T00:00:00.000002Z',null),
        ('${classA}','micro earlier','${ownerStudent}',false,'2020-01-01T00:00:00.000001Z',null),
        ('${classA}','scheduled past','${ownerStudent}',false,'2021-01-01T00:00:00Z','2021-01-01T00:00:00Z'),
        ('${classA}','scheduled boundary','${ownerStudent}',false,'${requestCutoff}','${requestCutoff}'),
        ('${classA}','scheduled future','${ownerStudent}',false,'2030-01-01T00:00:00Z','2030-01-01T00:00:00Z'),
        ('${classA}','future publication without schedule','${ownerStudent}',false,'2030-01-01T00:00:00Z',null),
        ('${hiddenClass}','hidden draft','${ownerStudent}',true,null,null),
        ('${hiddenClass}','hidden future','${ownerStudent}',false,'2030-01-01T00:00:00Z','2030-01-01T00:00:00Z'),
        ('${classB}','other published one','${ownerTeacher}',false,'2020-01-01T00:00:00Z',null),
        ('${classB}','other published two','${ownerTeacher}',false,'2020-01-01T00:00:00Z',null),
        ('${classB}','other published three','${ownerTeacher}',false,'2020-01-01T00:00:00Z',null),
        ('${classB}','other draft one','${ownerTeacher}',true,null,null),
        ('${classB}','other draft two','${ownerTeacher}',true,null,null);
      commit;`)
    if (forcedCleanup) throw new Error('Forced post-fixture cleanup proof')
    const trace = instrument(ownerStudent, classA, 'owner')
    const owner = await read(ownerStudent, classA, 'owner', trace.client)
    assert.equal(owner.announcements.length, 1009)
    assert(trace.pages() >= 3, '1001+ rows include a terminal empty bound statement')
    assert.equal(new Set(owner.announcements.map(row => row.id)).size, 1009)
    assert.deepEqual(Object.keys(owner), ['announcements'])
    assert.deepEqual(Object.keys(owner.announcements[0]).sort(), [
      'id','classroom_id','title','content','created_by','is_draft','published_at','scheduled_for','created_at','updated_at',
    ].sort())
    assert(!JSON.stringify(owner).includes('other published'))
    const contents = owner.announcements.map(row => row.content)
    assert(contents.indexOf('micro later') < contents.indexOf('micro earlier'))
    assert(owner.announcements.slice(0, 2).every(row => row.is_draft && row.published_at === null))
    assert(trace.cursors[1]?.includes('published_at.eq.'), 'Timestamp ties use UUID keysets')
    for (const actor of [memberStudent, memberTeacher]) {
      const memberTrace = instrument(actor, classA, 'member')
      const member = await read(actor, classA, 'member', memberTrace.client)
      assert.equal(member.announcements.length, 1006)
      assert(member.announcements.every(row => !row.is_draft))
      assert(!member.announcements.some(row => row.content === 'scheduled future'))
      assert(member.announcements.some(row => row.content === 'scheduled boundary'))
      assert(member.announcements.some(row => row.content === 'future publication without schedule'))
    }
    assert.deepEqual(await read(ownerStudent, emptyClass, 'owner'), { announcements: [] })
    assert.deepEqual(await read(memberTeacher, emptyClass, 'member'), { announcements: [] })
    assert.deepEqual(await read(memberTeacher, hiddenClass, 'member'), { announcements: [] })
    await assert.rejects(read(ownerStudent, classA, 'member'), { statusCode: 403 })
    await assert.rejects(read(outsider, classA, 'owner'), { statusCode: 403 })
    await assert.rejects(read(outsider, classA, 'member'), { statusCode: 403 })
    await assert.rejects(read(ownerStudent, randomUUID(), 'owner'), { statusCode: 404 })
    sql(`update public.classrooms set archived_at=clock_timestamp() where id='${classA}';`)
    assert.equal((await read(ownerStudent, classA, 'owner')).announcements.length, 1009)
    await assert.rejects(read(memberTeacher, classA, 'member'), { statusCode: 403 })
    sql(`update public.classrooms set archived_at=null where id='${classA}';`)
    process.stdout.write('PASS real left-announcement/inner-membership embedding, 1001+ timestamp-tie pagination, cross-role access, exact projection, microseconds, schedules, empty/hidden lists and archived-owner precedence\n')

    const shortOwner = instrument(ownerTeacher, classB, 'owner', { pageSize: 1 })
    assert.equal((await read(ownerTeacher, classB, 'owner', shortOwner.client)).announcements.length, 5)
    assert.equal(shortOwner.pages(), 6)
    assert(shortOwner.cursors[1]?.includes('published_at.is.null'), 'Draft/null keysets retain remaining drafts and publications')
    const shortMember = instrument(memberTeacher, classB, 'member', { pageSize: 1 })
    assert.equal((await read(memberTeacher, classB, 'member', shortMember.client)).announcements.length, 3)
    assert.equal(shortMember.pages(), 4)
    sql(`update public.classrooms set teacher_id='${ownerStudent}' where id='${classB}';`)
    const transferredRows = (await read(ownerStudent, classB, 'owner')).announcements
    assert.equal(transferredRows.length, 5)
    assert(transferredRows.every(row => row.created_by === ownerTeacher), 'Ownership transfer preserves historical authorship')
    resetClassB()
    for (const page of [1, 2, 6]) {
      const transferred = instrument(ownerTeacher, classB, 'owner', { beforePage: page, pageSize: 1,
        mutation: () => { sql(`update public.classrooms set teacher_id='${ownerStudent}' where id='${classB}';`) } })
      await assert.rejects(read(ownerTeacher, classB, 'owner', transferred.client), { statusCode: 403 })
      assert.equal(transferred.pages(), page)
      resetClassB()
    }
    for (const page of [1, 2, 4]) {
      for (const mutation of [
        () => { sql(`delete from public.classroom_enrollments where classroom_id='${classB}' and student_id='${memberTeacher}';`) },
        () => { sql(`update public.classrooms set archived_at=clock_timestamp() where id='${classB}';`) },
        () => { sql(`update public.classrooms set teacher_id='${memberTeacher}' where id='${classB}';`) },
      ]) {
        const revoked = instrument(memberTeacher, classB, 'member', { beforePage: page, pageSize: 1, mutation })
        await assert.rejects(read(memberTeacher, classB, 'member', revoked.client), { statusCode: 403 })
        assert.equal(revoked.pages(), page)
        resetClassB()
      }
    }
    process.stdout.write('PASS short pages including null-to-published transition; ownership transfer/member removal/archive/owner-precedence before first, later and terminal reads discard accumulated results\n')
    const firstId = (await read(ownerTeacher, classB, 'owner')).announcements[0].id
    const deleted = instrument(ownerTeacher, classB, 'owner', { beforePage: 2, pageSize: 1,
      mutation: () => { sql(`delete from public.announcements where id='${firstId}' and classroom_id='${classB}';`) } })
    assert.equal((await read(ownerTeacher, classB, 'owner', deleted.client)).announcements.length, 5,
      'An already-read deletion does not skip unread keyset rows; returned rows are statement snapshots')
    process.stdout.write('PASS deletion-safe keysets without claiming an immutable cross-page content snapshot\n')
  } finally {
    // Unconditional: setup may have committed even if the command outcome was ambiguous.
    sql(`begin;
      create temp table announcement_fixture_provision_ops(operation_id uuid,subject_user_id uuid,primary key(operation_id,subject_user_id)) on commit drop;
      insert into announcement_fixture_provision_ops select audit.operation_id,audit.subject_user_id
        from public.account_plan_audit audit join (values ${identities}) fixture(id,email) on fixture.id=audit.subject_user_id
        join public.users u on u.id=fixture.id and u.email=fixture.email
        where audit.actor_ref='system:user-provisioning' and audit.reason_code='default_free_account_provisioning';
      delete from public.effective_feature_entitlement_audit audit using (values ${operationsSql}) fixture(operation_id,u)
        where audit.operation_id=fixture.operation_id and audit.subject_user_id=fixture.u
          and audit.actor_ref='test:announcement-read' and audit.reason_code='${tag}' and audit.feature_key='classrooms.create'
          and exists(select 1 from public.users u join (values ${identities}) identity(id,email) on identity.id=u.id and identity.email=u.email where u.id=fixture.u);
      delete from public.effective_feature_entitlement_audit audit using announcement_fixture_provision_ops operation
        where audit.operation_id=operation.operation_id and audit.subject_user_id=operation.subject_user_id
          and audit.actor_ref='system:user-provisioning' and audit.reason_code='default_free_account_provisioning' and audit.feature_key='classrooms.create';
      delete from public.account_plan_audit audit using announcement_fixture_provision_ops operation
        where audit.operation_id=operation.operation_id and audit.subject_user_id=operation.subject_user_id
          and audit.actor_ref='system:user-provisioning' and audit.reason_code='default_free_account_provisioning';
      delete from public.classrooms where id in (${classesSql}) and title in ('${tag} A','${tag} B','${tag} empty','${tag} hidden')
        and class_code in ('${tag}_a','${tag}_b','${tag}_empty','${tag}_hidden');
      delete from public.users u using (values ${identities}) identity(id,email) where u.id=identity.id and u.email=identity.email;
      commit;`)
    assert.equal(sql(`select
      (select count(*) from public.users where id in (${userIds}))+
      (select count(*) from public.classrooms where id in (${classesSql}))+
      (select count(*) from public.announcements where classroom_id in (${classesSql}))+
      (select count(*) from public.classroom_enrollments where student_id in (${userIds}))+
      (select count(*) from public.account_plans where subject_user_id in (${userIds}))+
      (select count(*) from public.account_plan_audit where subject_user_id in (${userIds}))+
      (select count(*) from public.effective_feature_entitlements where subject_user_id in (${userIds}))+
      (select count(*) from public.effective_feature_entitlement_audit where subject_user_id in (${userIds})
        or operation_id in (select operation_id from (values ${operationsSql}) fixture(operation_id,u)));`), '0')
    process.stdout.write('PASS exact synthetic fixture cleanup with zero residual rows\n')
  }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
