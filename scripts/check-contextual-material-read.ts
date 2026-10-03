// Local-only SDK/PostgREST proof. Random exact fixtures; no migration or hosted calls.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { readContextualMaterials } from '../src/lib/server/contextual-material-read'
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
    return execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt',
      '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], {
      input: `set statement_timeout='40s'; set lock_timeout='5s'; ${statement}`,
      encoding: 'utf8', timeout: 45_000, maxBuffer: 5_000_000,
    }).trim()
  }
  function liveState() {
    return JSON.parse(sql(`select jsonb_build_object(
      'users',(select count(*) from public.users),
      'classrooms',(select count(*) from public.classrooms),
      'materials',(select count(*) from public.classwork_materials),
      'enrollments',(select count(*) from public.classroom_enrollments),
      'revisions',(select count(*) from public.classroom_archive_revisions),
      'plans',(select count(*) from public.account_plans),
      'plan_audit',(select count(*) from public.account_plan_audit),
      'entitlements',(select count(*) from public.effective_feature_entitlements),
      'entitlement_audit',(select count(*) from public.effective_feature_entitlement_audit));`))
  }
  const baseline = liveState()
  const tag = `matread_${randomUUID().slice(0, 8)}`
  const users = [
    { id: randomUUID(), label: 'owner_student', role: 'student' },
    { id: randomUUID(), label: 'owner_teacher', role: 'teacher' },
    { id: randomUUID(), label: 'member_student', role: 'student' },
    { id: randomUUID(), label: 'member_teacher', role: 'teacher' },
    { id: randomUUID(), label: 'outsider', role: 'teacher' },
  ] as const
  const [ownerStudent, ownerTeacher, memberStudent, memberTeacher, outsider] = users.map(user => user.id)
  const identities = users.map(user => `('${user.id}'::uuid,'${tag}_${user.label}@example.invalid')`).join(',')
  const userIds = users.map(user => `'${user.id}'::uuid`).join(',')
  const operations = [ownerStudent, ownerTeacher, memberTeacher].map(subject => ({ subject, id: randomUUID() }))
  const operationValues = operations.map(op => `('${op.id}'::uuid,'${op.subject}'::uuid)`).join(',')
  const classA = randomUUID(), classB = randomUUID(), emptyClass = randomUUID(), draftClass = randomUUID()
  const classes = [
    { id: classA, label: 'A', owner: ownerStudent, code: 'a' },
    { id: classB, label: 'B', owner: ownerTeacher, code: 'b' },
    { id: emptyClass, label: 'empty', owner: ownerStudent, code: 'empty' },
    { id: draftClass, label: 'draft', owner: ownerStudent, code: 'draft' },
  ]
  const classIds = classes.map(item => `'${item.id}'::uuid`).join(',')
  const complex = randomUUID(), draft = randomUUID(), future = randomUUID(), early = randomUUID(), late = randomUUID(), nullRelease = randomUUID()
  const bIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
  const rich = { type: 'doc', content: [
    { type: 'paragraph', attrs: { align: 'center' }, content: [
      { type: 'text', text: 'Source rich text', marks: [{ type: 'link', attrs: { href: 'https://example.invalid/source' } }] },
    ] },
    { type: 'image', attrs: { src: 'https://example.invalid/figure.png', alt: 'Figure', width: 640 } },
  ] }
  const doc = { type: 'doc', content: [] }
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
  const richSql = `${quote(JSON.stringify(rich))}::jsonb`, docSql = `${quote(JSON.stringify(doc))}::jsonb`
  const materialFields = [
    'id','classroom_id','title','content','is_draft','released_at','created_by','created_at','updated_at',
    'position','artifact_id','source_artifact_id','blueprint_archived_at','source_blueprint_version_id',
  ]
  type Permission = 'owner' | 'member'
  const read = (actorId: string, classroomId: string, permission: Permission, supabase = service) =>
    readContextualMaterials({ supabase, actorId, classroomId, permission })
  type InstrumentOptions = {
    beforePage?: number
    mutation?: () => void
    pageSize?: number
    schemaErrorAt?: number
    tamper?: (page: number, body: Record<string, unknown>, firstId: string | null) => void
  }
  function instrument(actorId: string, classroomId: string, permission: Permission, options: InstrumentOptions = {}) {
    let pages = 0
    let firstId: string | null = null
    const cursors: Array<string | null> = []
    const client = createClient<Database>(status.API_URL, status.SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (input, init) => {
        const url = new URL(String(input))
        assert(!url.pathname.startsWith('/rest/v1/rpc/'), 'No RPC fallback')
        assert.notEqual(url.pathname, '/rest/v1/classwork_materials', 'No unbound material payload query')
        const select = url.searchParams.get('select') ?? ''
        if (url.pathname === '/rest/v1/classrooms' && select.includes('materials:')) {
          pages++
          assert(pages < 20, 'Bounded fixture query count; no retry/fallback')
          assert.equal(url.searchParams.get('id'), `eq.${classroomId}`)
          assert.equal(url.searchParams.get('teacher_id'), `${permission === 'owner' ? 'eq' : 'neq'}.${actorId}`)
          assert.match(select, /materials:classwork_materials!classwork_materials_classroom_id_fkey\(/)
          assert(!select.includes('classwork_materials_classroom_id_fkey!inner'), 'Empty lists retain the classroom root')
          for (const field of materialFields) assert.match(select, new RegExp(`\\b${field}\\b`))
          const order = url.searchParams.get('materials.order') ?? ''
          assert.match(order, permission === 'owner'
            ? /^position\.asc,created_at\.asc,id\.asc$/
            : /^position\.asc,released_at\.asc(?:\.nullslast)?,id\.asc$/)
          assert.equal(url.searchParams.get('materials.limit'), '1000')
          if (permission === 'member') {
            assert.match(select, /membership:classroom_enrollments!classroom_enrollments_classroom_id_fkey!inner\(/)
            assert.equal(url.searchParams.get('membership.student_id'), `eq.${actorId}`)
            assert.equal(url.searchParams.get('archived_at'), 'is.null')
            assert.equal(url.searchParams.get('materials.is_draft'), 'eq.false')
          }
          cursors.push(url.searchParams.get('materials.or'))
          if (pages === options.beforePage) options.mutation?.()
          if (options.pageSize !== undefined) url.searchParams.set('materials.limit', String(options.pageSize))
          if (pages === options.schemaErrorAt) {
            return new Response(JSON.stringify({ code: 'PGRST205', message: 'Synthetic missing table' }), {
              status: 404, headers: { 'content-type': 'application/json' },
            })
          }
          const response = await fetch(url, init)
          if (!response.ok) return response
          const body = await response.json() as Record<string, unknown>
          const row = (Array.isArray(body) ? body[0] : body) as Record<string, unknown> | undefined
          if (row && Array.isArray(row.materials) && row.materials.length > 0 && !firstId) {
            firstId = (row.materials[0] as { id: string }).id
          }
          if (row && options.tamper) options.tamper(pages, row, firstId)
          const headers = new Headers(response.headers)
          headers.delete('content-length')
          return new Response(JSON.stringify(body), { status: response.status, headers })
        }
        return fetch(url, init)
      } },
    })
    return { client, pages: () => pages, cursors }
  }
  function resetB() {
    sql(`update public.classrooms set teacher_id='${ownerTeacher}',archived_at=null where id='${classB}';
      insert into public.classroom_enrollments(classroom_id,student_id)
        values('${classB}','${memberTeacher}') on conflict do nothing;`)
  }
  try {
    sql(`begin;
      insert into public.users(id,email,role) values ${users.map(user => `('${user.id}','${tag}_${user.label}@example.invalid','${user.role}')`).join(',')};
      set local role service_role;
      select public.set_effective_feature_entitlement_v1(operation_id,u,'classrooms.create','manual',true,
        clock_timestamp(),null,4,'test:material-read','${tag}',
        coalesce((select revision from public.effective_feature_entitlements where subject_user_id=u and feature_key='classrooms.create'),0))
        from (values ${operationValues}) fixture(operation_id,u);
      reset role;
      insert into public.classrooms(id,teacher_id,title,class_code) values
        ${classes.map(item => `('${item.id}','${item.owner}','${tag} ${item.label}','${tag}_${item.code}')`).join(',')};
      insert into public.classroom_enrollments(classroom_id,student_id)
        select c,u from unnest(array[${classIds}]) c
        cross join unnest(array['${memberStudent}'::uuid,'${memberTeacher}'::uuid]) u;
      insert into public.classroom_enrollments(classroom_id,student_id) values('${classA}','${ownerStudent}');
      insert into public.classwork_materials(classroom_id,title,content,is_draft,released_at,created_by,position,created_at)
        select '${classA}','bulk '||n,${docSql},false,'2020-01-01T00:00:00.123456Z','${ownerStudent}',10,
          '2020-01-01T00:00:00.123456Z' from generate_series(1,1001) n;
      insert into public.classwork_materials(id,classroom_id,title,content,is_draft,released_at,created_by,position,created_at,
        source_artifact_id,blueprint_archived_at) values
        ('${complex}','${classA}','Complex image and marks',${richSql},false,null,'${ownerStudent}',-5,'2019-01-01T00:00:00Z',
          '${randomUUID()}','2020-02-01T00:00:00.123456Z'),
        ('${draft}','${classA}','Draft',${docSql},true,null,'${ownerStudent}',-4,'2019-01-02T00:00:00Z',null,null),
        ('${future}','${classA}','Future release',${docSql},false,'2030-01-01T00:00:00Z','${ownerStudent}',-3,
          '2019-01-03T00:00:00Z',null,null),
        ('${early}','${classA}','Micro early',${docSql},false,'2020-01-01T00:00:00.000001Z','${ownerStudent}',-2,
          '2020-01-01T00:00:00.000002Z',null,null),
        ('${late}','${classA}','Micro late',${docSql},false,'2020-01-01T00:00:00.000002Z','${ownerStudent}',-2,
          '2020-01-01T00:00:00.000001Z',null,null),
        ('${nullRelease}','${classA}','Null release',${docSql},false,null,'${ownerStudent}',-2,
          '2019-01-04T00:00:00Z',null,null);
      insert into public.classwork_materials(id,classroom_id,title,content,is_draft,released_at,created_by,position,created_at) values
        ('${bIds[0]}','${classB}','B release early',${docSql},false,'2020-01-01T00:00:00.000001Z','${ownerTeacher}',0,
          '2020-01-01T00:00:00.000002Z'),
        ('${bIds[1]}','${classB}','B release late',${docSql},false,'2020-01-01T00:00:00.000002Z','${ownerTeacher}',0,
          '2020-01-01T00:00:00.000001Z'),
        ('${bIds[2]}','${classB}','B null release',${docSql},false,null,'${ownerTeacher}',0,
          '2020-01-01T00:00:00.000003Z'),
        ('${bIds[3]}','${classB}','B draft',${docSql},true,null,'${ownerTeacher}',1,
          '2020-01-01T00:00:00.000004Z');
      insert into public.classwork_materials(classroom_id,title,content,is_draft,created_by,position)
        values('${draftClass}','Hidden draft',${docSql},true,'${ownerStudent}',0);
      commit;`)
    if (process.argv.includes('--verify-cleanup-after-fixture')) throw new Error('Forced post-fixture cleanup proof')

    const ownerTrace = instrument(ownerStudent, classA, 'owner')
    const owner = await read(ownerStudent, classA, 'owner', ownerTrace.client)
    assert.deepEqual(Object.keys(owner), ['materials'])
    assert.equal(owner.materials.length, 1007)
    assert.equal(ownerTrace.pages(), 3, '1,001+ rows require two data pages and terminal empty page')
    assert.equal(new Set(owner.materials.map(row => row.id)).size, 1007)
    assert.deepEqual(Object.keys(owner.materials[0]).sort(), [...materialFields].sort())
    assert.equal(owner.materials[0].id, complex)
    assert.deepEqual(owner.materials[0].content, rich)
    assert.match(owner.materials[0].blueprint_archived_at ?? '', /^2020-02-01T00:00:00\.123456(?:\+00:00|Z)$/)
    assert.equal(owner.materials[0].source_blueprint_version_id, null)
    assert.equal(owner.materials[0].source_artifact_id !== null, true)
    assert.equal(owner.materials[1].id, draft)
    assert.equal(owner.materials[2].id, future)
    assert.deepEqual(owner.materials.slice(3, 6).map(row => row.id), [nullRelease, late, early],
      'Owner order uses created_at, preserving microsecond distinctions')
    const ownerBulk = owner.materials.filter(row => row.position === 10)
    assert.equal(ownerBulk.length, 1001)
    assert.deepEqual(ownerBulk.map(row => row.id), [...ownerBulk.map(row => row.id)].sort(), 'Owner tied rows use ID keyset')
    const memberTrace = instrument(memberTeacher, classA, 'member')
    const member = await read(memberTeacher, classA, 'member', memberTrace.client)
    assert.equal(member.materials.length, 1006)
    assert.equal(memberTrace.pages(), 3)
    assert(!member.materials.some(row => row.id === draft))
    assert(member.materials.some(row => row.id === future), 'Future released_at alone is not a visibility gate')
    assert.deepEqual(member.materials.filter(row => row.position === -2).map(row => row.id), [early, late, nullRelease],
      'Member order retains microseconds and puts null release last')
    assert.equal((await read(memberStudent, classA, 'member')).materials.length, 1006)
    const bOwner = await read(ownerTeacher, classB, 'owner')
    assert.deepEqual(bOwner.materials.map(row => row.id), [bIds[1], bIds[0], bIds[2], bIds[3]],
      'Owner tied positions follow created_at microseconds before ID')
    const bMember = await read(memberTeacher, classB, 'member')
    assert.deepEqual(bMember.materials.map(row => row.id), [bIds[0], bIds[1], bIds[2]],
      'Member tied positions follow released_at microseconds, then null last')
    assert.deepEqual(await read(ownerStudent, emptyClass, 'owner'), { materials: [] })
    assert.deepEqual(await read(memberTeacher, emptyClass, 'member'), { materials: [] })
    assert.equal((await read(ownerStudent, draftClass, 'owner')).materials.length, 1)
    assert.deepEqual(await read(memberTeacher, draftClass, 'member'), { materials: [] })
    await assert.rejects(read(ownerStudent, classA, 'member'), { statusCode: 403 })
    await assert.rejects(read(memberTeacher, classA, 'owner'), { statusCode: 403 })
    await assert.rejects(read(outsider, classA, 'owner'), { statusCode: 403 })
    await assert.rejects(read(outsider, classA, 'member'), { statusCode: 403 })
    await assert.rejects(read(ownerStudent, randomUUID(), 'owner'), { statusCode: 404 })
    sql(`update public.classrooms set archived_at=clock_timestamp() where id='${classA}';`)
    assert.equal((await read(ownerStudent, classA, 'owner')).materials.length, 1007)
    await assert.rejects(read(memberTeacher, classA, 'member'), { statusCode: 403 })
    sql(`update public.classrooms set archived_at=null where id='${classA}';`)
    sql(`update public.classrooms set teacher_id='${ownerStudent}' where id='${classB}';`)
    const historical = await read(ownerStudent, classB, 'owner')
    assert.equal(historical.materials.length, 4)
    assert(historical.materials.every(row => row.created_by === ownerTeacher), 'Transferred authorship remains historical')
    resetB()
    process.stdout.write('PASS live material SDK 1007/1006 complete keysets, two global roles, full projection, rich content, ordering, owner/member visibility and current relationships\n')

    sql(`update public.classwork_materials set content='null'::jsonb where id='${bIds[0]}' and classroom_id='${classB}';`)
    for (const [actor, permission] of [[ownerTeacher, 'owner'], [memberTeacher, 'member']] as const) {
      await assert.rejects(read(actor, classB, permission), { statusCode: 503, message: 'Unable to verify classroom materials' })
    }
    sql(`update public.classwork_materials set content=${docSql} where id='${bIds[0]}' and classroom_id='${classB}';`)
    process.stdout.write('PASS real PostgreSQL JSONB null fails closed for owner and member\n')

    const shortOwner = instrument(ownerTeacher, classB, 'owner', { pageSize: 1 })
    assert.deepEqual((await read(ownerTeacher, classB, 'owner', shortOwner.client)).materials.map(row => row.id),
      [bIds[1], bIds[0], bIds[2], bIds[3]])
    assert.equal(shortOwner.pages(), 5)
    assert(shortOwner.cursors[1]?.includes('2020-01-01T00:00:00.000001') && shortOwner.cursors[1]?.includes(bIds[1]),
      'Owner cursor retains first microsecond and ID')
    assert(shortOwner.cursors[2]?.includes('2020-01-01T00:00:00.000002') && shortOwner.cursors[2]?.includes(bIds[0]),
      'Owner cursor retains next microsecond and ID')
    const shortMember = instrument(memberTeacher, classB, 'member', { pageSize: 1 })
    assert.deepEqual((await read(memberTeacher, classB, 'member', shortMember.client)).materials.map(row => row.id),
      [bIds[0], bIds[1], bIds[2]])
    assert.equal(shortMember.pages(), 4)
    assert(shortMember.cursors[1]?.includes('2020-01-01T00:00:00.000001') && shortMember.cursors[1]?.includes(bIds[0]),
      'Member cursor retains first microsecond and ID')
    assert(shortMember.cursors[2]?.includes('2020-01-01T00:00:00.000002') && shortMember.cursors[2]?.includes(bIds[1]),
      'Member cursor retains next microsecond and ID')
    assert(shortMember.cursors[3]?.includes('released_at.is.null') && shortMember.cursors[3]?.includes(bIds[2]),
      'Member terminal cursor uses the null-release branch and ID')
    for (const page of [1, 2, 5]) {
      const transfer = instrument(ownerTeacher, classB, 'owner', { beforePage: page, pageSize: 1,
        mutation: () => { sql(`update public.classrooms set teacher_id='${ownerStudent}' where id='${classB}';`) } })
      await assert.rejects(read(ownerTeacher, classB, 'owner', transfer.client), { statusCode: 403 })
      assert.equal(transfer.pages(), page)
      resetB()
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
        resetB()
      }
    }
    process.stdout.write('PASS forced short pages and revocation before first, later and terminal payload statements\n')

    for (const [actor, permission] of [[ownerTeacher, 'owner'], [memberTeacher, 'member']] as const) {
      const invalidIdentity = instrument(actor, classB, permission, { pageSize: 1, tamper: (page, row) => {
        if (page === 2) (row.materials as Array<Record<string, unknown>>)[0].artifact_id = null
      } })
      await assert.rejects(read(actor, classB, permission, invalidIdentity.client), { statusCode: 503 })
      assert.equal(invalidIdentity.pages(), 2, 'Null artifact identity discards the accumulated first page')
    }
    process.stdout.write('PASS owner and member null artifact identities fail closed without partial lists\n')

    for (const tamper of [
      (page: number, row: Record<string, unknown>) => { if (page === 2) row.materials = null },
      (page: number, row: Record<string, unknown>) => {
        if (page === 2) (row.materials as Array<Record<string, unknown>>)[0].classroom_id = classA
      },
      (page: number, row: Record<string, unknown>, firstId: string | null) => {
        if (page === 2) (row.materials as Array<Record<string, unknown>>)[0].id = firstId
      },
      (page: number, row: Record<string, unknown>) => {
        if (page === 2) (row.materials as Array<Record<string, unknown>>)[0].position = -100
      },
      (page: number, row: Record<string, unknown>) => {
        if (page === 2) (row.materials as Array<Record<string, unknown>>)[0].extra = true
      },
    ]) {
      const corrupted = instrument(ownerTeacher, classB, 'owner', { pageSize: 1, tamper })
      await assert.rejects(read(ownerTeacher, classB, 'owner', corrupted.client), { statusCode: 503 })
      assert.equal(corrupted.pages(), 2)
    }
    const draftLeak = instrument(memberTeacher, classB, 'member', { pageSize: 1, tamper: (page, row) => {
      if (page === 2) (row.materials as Array<Record<string, unknown>>)[0].is_draft = true
    } })
    await assert.rejects(read(memberTeacher, classB, 'member', draftLeak.client), { statusCode: 503 })
    const missingSchema = instrument(ownerTeacher, classB, 'owner', { pageSize: 1, schemaErrorAt: 2 })
    await assert.rejects(read(ownerTeacher, classB, 'owner', missingSchema.client), { statusCode: 503 })
    assert.equal(missingSchema.pages(), 2)
    process.stdout.write('PASS malformed/substituted later pages, duplicate/backward cursors, member draft leak and missing-schema no-fallback\n')

    const deletion = instrument(ownerTeacher, classB, 'owner', { beforePage: 2, pageSize: 1,
      mutation: () => { sql(`delete from public.classwork_materials where id='${bIds[1]}' and classroom_id='${classB}';`) } })
    assert.equal((await read(ownerTeacher, classB, 'owner', deletion.client)).materials.length, 4,
      'A deleted prior row does not skip unread keyset rows')
    assert(deletion.cursors[1] !== null, 'Page two uses a keyset cursor')
    process.stdout.write('PASS deletion-safe keyset after an already-read row\n')
  } finally {
    // Setup may have committed even if its command result was ambiguous.
    sql(`begin;
      create temp table material_fixture_provision_ops(operation_id uuid,subject_user_id uuid,primary key(operation_id,subject_user_id)) on commit drop;
      insert into material_fixture_provision_ops select audit.operation_id,audit.subject_user_id
        from public.account_plan_audit audit join (values ${identities}) identity(id,email)
          on identity.id=audit.subject_user_id
        join public.users fixture on fixture.id=identity.id and fixture.email=identity.email
        where audit.actor_ref='system:user-provisioning' and audit.reason_code='default_free_account_provisioning';
      delete from public.effective_feature_entitlement_audit audit using (values ${operationValues}) fixture(operation_id,u)
        where audit.operation_id=fixture.operation_id and audit.subject_user_id=fixture.u
          and audit.actor_ref='test:material-read' and audit.reason_code='${tag}' and audit.feature_key='classrooms.create';
      delete from public.effective_feature_entitlement_audit audit using material_fixture_provision_ops operation
        where audit.operation_id=operation.operation_id and audit.subject_user_id=operation.subject_user_id
          and audit.actor_ref='system:user-provisioning' and audit.reason_code='default_free_account_provisioning'
          and audit.feature_key='classrooms.create';
      delete from public.account_plan_audit audit using material_fixture_provision_ops operation
        where audit.operation_id=operation.operation_id and audit.subject_user_id=operation.subject_user_id
          and audit.actor_ref='system:user-provisioning' and audit.reason_code='default_free_account_provisioning';
      delete from public.classrooms classroom using (values
        ${classes.map(item => `('${item.id}'::uuid,'${tag} ${item.label}','${tag}_${item.code}')`).join(',')}
      ) fixture(id,title,class_code)
        where classroom.id=fixture.id and classroom.title=fixture.title and classroom.class_code=fixture.class_code;
      delete from public.users fixture using (values ${identities}) identity(id,email)
        where fixture.id=identity.id and fixture.email=identity.email;
      commit;`)
    assert.equal(sql(`select
      (select count(*) from public.users where id in (${userIds}))+
      (select count(*) from public.classrooms where id in (${classIds}))+
      (select count(*) from public.classwork_materials where classroom_id in (${classIds}))+
      (select count(*) from public.classroom_enrollments where student_id in (${userIds}))+
      (select count(*) from public.classroom_archive_revisions where classroom_id in (${classIds}))+
      (select count(*) from public.account_plans where subject_user_id in (${userIds}))+
      (select count(*) from public.account_plan_audit where subject_user_id in (${userIds}))+
      (select count(*) from public.effective_feature_entitlements where subject_user_id in (${userIds}))+
      (select count(*) from public.effective_feature_entitlement_audit where subject_user_id in (${userIds})
        or operation_id in (select operation_id from (values ${operationValues}) fixture(operation_id,u)));`), '0')
    assert.deepEqual(liveState(), baseline, 'All public fixture tables returned to their initial counts')
    assert.equal(sql(`select count(*) from pg_stat_activity where application_name like '${tag}%';`), '0')
    process.stdout.write('PASS exact synthetic material fixture cleanup with zero residual rows\n')
  }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
