// Local-only PostgREST contract: synthetic fixtures; no migration, AI or hosted calls.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { readContextualLessonPlans } from '../src/lib/server/contextual-lesson-plan-read'
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
    return execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XAt', '-v', 'ON_ERROR_STOP=1'], {
      input: `set statement_timeout='15s'; set lock_timeout='3s'; ${statement}`, encoding: 'utf8',
    }).trim()
  }
  const tag = `lpr_${randomUUID().slice(0, 8)}`
  const ownerStudent = randomUUID(), ownerTeacher = randomUUID(), outsider = randomUUID()
  const memberStudent = randomUUID(), memberTeacher = randomUUID()
  const userIds = [ownerStudent, ownerTeacher, outsider, memberStudent, memberTeacher]
  const idsSql = userIds.map(id => `'${id}'::uuid`).join(',')
  const operationsSql = [ownerStudent, ownerTeacher, memberTeacher].map(subject => `('${randomUUID()}'::uuid,'${subject}'::uuid)`).join(',')
  const classA = randomUUID(), classB = randomUUID(), emptyClass = randomUUID()
  const classesSql = `'${classA}','${classB}','${emptyClass}'`
  const todaySql = "(clock_timestamp() at time zone 'America/Toronto')::date"
  const [today, nextWeek, later, saturday] = sql(`select ${todaySql},${todaySql}+7,${todaySql}+14,
    ${todaySql}+(6-extract(dow from ${todaySql})::int);`).split('\n').at(-1)!.split('|')
  const fullStart = '2000-01-01', fullEnd = '2100-12-31'
  type Permission = 'owner' | 'member'
  const read = (actorId: string, classroomId: string, permission: Permission, client = service, start = fullStart, end = fullEnd) =>
    readContextualLessonPlans({ supabase: client, actorId, classroomId, start, end, permission })
  function instrument(actorId: string, classroomId: string, permission: Permission,
    options: { beforePage?: number; mutation?: () => void; pageSize?: number } = {}) {
    let pages = 0
    const cursors: Array<string | null> = []
    const client = createClient<Database>(status.API_URL, status.SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (input, init) => {
        const url = new URL(String(input))
        assert(!url.pathname.startsWith('/rest/v1/rpc/'), 'No RPC fallback')
        assert.notEqual(url.pathname, '/rest/v1/lesson_plans', 'No unbound plan payload query')
        const select = url.searchParams.get('select') ?? ''
        if (url.pathname === '/rest/v1/classrooms' && select.includes('plans:')) {
          pages++
          assert(pages < 20, 'Bounded fixture query count; no retry/fallback')
          assert.equal(url.searchParams.get('id'), `eq.${classroomId}`)
          assert.equal(url.searchParams.get('teacher_id'), `${permission === 'owner' ? 'eq' : 'neq'}.${actorId}`)
          assert.match(select, /plans:lesson_plans!lesson_plans_classroom_id_fkey\(/)
          assert(!select.includes('lesson_plans_classroom_id_fkey!inner'), 'Empty authorized plan range must retain classroom root')
          assert.equal(url.searchParams.get('plans.order'), 'date.asc')
          assert(Number(url.searchParams.get('plans.limit')) > 0)
          if (permission === 'member') {
            assert.match(select, /membership:classroom_enrollments!classroom_enrollments_classroom_id_fkey!inner\(/)
            assert.equal(url.searchParams.get('membership.student_id'), `eq.${actorId}`)
            assert.equal(url.searchParams.get('archived_at'), 'is.null')
            assert(select.includes('lesson_plan_visibility'))
          }
          cursors.push(url.searchParams.getAll('plans.date').find(value => value.startsWith('gt.')) ?? null)
          if (pages === options.beforePage) options.mutation?.()
          if (options.pageSize !== undefined) url.searchParams.set('plans.limit', String(options.pageSize))
        }
        return fetch(url, init)
      } },
    })
    return { client, pages: () => pages, cursors }
  }
  function resetClass() {
    sql(`update public.classrooms set teacher_id='${ownerStudent}',archived_at=null,lesson_plan_visibility='all' where id='${classA}';
      insert into public.classroom_enrollments(classroom_id,student_id) values('${classA}','${memberTeacher}') on conflict do nothing;`)
  }
  let created = false
  try {
    sql(`begin;
      insert into public.users(id,email,role) values
        ('${ownerStudent}','${tag}_owner_student@example.invalid','student'),
        ('${ownerTeacher}','${tag}_owner_teacher@example.invalid','teacher'),
        ('${outsider}','${tag}_outsider@example.invalid','teacher'),
        ('${memberStudent}','${tag}_member_student@example.invalid','student'),
        ('${memberTeacher}','${tag}_member_teacher@example.invalid','teacher');
      set local role service_role;
      select public.set_effective_feature_entitlement_v1(operation_id,u,'classrooms.create','manual',true,
        clock_timestamp(),null,3,'test:lesson-plan-read','lesson_plan_read_fixture',
        coalesce((select revision from public.effective_feature_entitlements where subject_user_id=u and feature_key='classrooms.create'),0))
      from (values ${operationsSql}) fixture(operation_id,u);
      reset role;
      insert into public.classrooms(id,teacher_id,title,class_code,lesson_plan_visibility) values
        ('${classA}','${ownerStudent}','${tag} A','${tag}_a','all'),
        ('${classB}','${ownerTeacher}','${tag} B','${tag}_b','all'),
        ('${emptyClass}','${ownerStudent}','${tag} empty','${tag}_empty','all');
      insert into public.classroom_enrollments(classroom_id,student_id) values
        ('${classA}','${memberStudent}'),('${classA}','${memberTeacher}'),('${classA}','${ownerStudent}'),
        ('${classB}','${memberStudent}'),('${emptyClass}','${memberTeacher}');
      insert into public.lesson_plans(classroom_id,date,content_markdown)
        select '${classA}','2000-01-01'::date+n,'synthetic plan '||n from generate_series(0,1000) n;
      insert into public.lesson_plans(classroom_id,date,content_markdown) values
        ('${classA}','${today}','synthetic today'),('${classA}','${nextWeek}','synthetic next week'),
        ('${classA}','${later}','synthetic later'),('${classB}','${today}','synthetic other classroom');
      commit;`)
    created = true
    const trace = instrument(ownerStudent, classA, 'owner')
    const owner = await read(ownerStudent, classA, 'owner', trace.client)
    assert.equal(owner.lesson_plans.length, 1004)
    assert(trace.pages() >= 3, '1001+ rows require keyset pages and terminal empty page')
    assert.equal(new Set(owner.lesson_plans.map(plan => plan.id)).size, 1004)
    assert.equal(owner.lesson_plans.at(-1)!.date, later)
    assert.deepEqual(Object.keys(owner).sort(), ['lesson_plans'])
    assert.deepEqual(Object.keys(owner.lesson_plans[0]).sort(), [
      'id','classroom_id','date','content','content_markdown','created_at','updated_at','artifact_id',
      'source_artifact_id','source_blueprint_version_id','blueprint_archived_at',
    ].sort())
    assert(!JSON.stringify(owner).includes('synthetic other classroom'))
    assert.equal((await read(ownerTeacher, classB, 'owner')).lesson_plans.length, 1)
    for (const actor of [memberStudent, memberTeacher]) {
      const member = await read(actor, classA, 'member')
      assert.equal(member.lesson_plans.length, 1004)
      assert('visibility' in member && member.visibility === 'all' && member.max_date === null)
    }
    assert.deepEqual(await read(ownerStudent, emptyClass, 'owner'), { lesson_plans: [] })
    assert.deepEqual(await read(memberTeacher, emptyClass, 'member'), { lesson_plans: [], visibility: 'all', max_date: null })
    await assert.rejects(read(ownerStudent, classA, 'member'), { statusCode: 403 })
    await assert.rejects(read(outsider, classA, 'owner'), { statusCode: 403 })
    await assert.rejects(read(outsider, classA, 'member'), { statusCode: 403 })
    await assert.rejects(read(ownerStudent, randomUUID(), 'owner'), { statusCode: 404 })
    sql(`update public.classrooms set archived_at=clock_timestamp() where id='${classA}';`)
    assert.equal((await read(ownerStudent, classA, 'owner')).lesson_plans.length, 1004)
    await assert.rejects(read(memberTeacher, classA, 'member'), { statusCode: 403 })
    resetClass()
    process.stdout.write('PASS actual left-plan/inner-membership embedding, 1001+ keyset pagination, both owner/member role values, projection/isolation, empty ranges, archived owner and owner precedence\n')

    sql(`update public.lesson_plans set content='null'::jsonb where classroom_id='${classA}' and date='${today}';`)
    for (const [actor, permission] of [[ownerStudent, 'owner'], [memberTeacher, 'member']] as const) {
      await assert.rejects(read(actor, classA, permission, service, today, today), {
        statusCode: 503, message: 'Unable to verify classroom lesson plans',
      }, 'JSON literal null bypasses SQL NOT NULL, but must fail the supported content contract')
    }
    sql(`update public.lesson_plans set content='{"type":"doc","content":[]}'::jsonb where classroom_id='${classA}' and date='${today}';`)
    process.stdout.write('PASS actual PostgreSQL JSONB null rejected as generic503 for owner and member reads\n')

    const short = instrument(memberTeacher, classA, 'member', { pageSize: 1 })
    assert.equal((await read(memberTeacher, classA, 'member', short.client, today, later)).lesson_plans.length, 3)
    assert.equal(short.pages(), 4, 'A short nonterminal page must not truncate the list')
    for (const page of [1, 2]) {
      const transfer = instrument(ownerStudent, classA, 'owner', { beforePage: page, pageSize: 1,
        mutation: () => { sql(`update public.classrooms set teacher_id='${ownerTeacher}' where id='${classA}';`) } })
      await assert.rejects(read(ownerStudent, classA, 'owner', transfer.client, today, later), { statusCode: 403 })
      assert.equal(transfer.pages(), page)
      resetClass()
      for (const mutation of [
        () => { sql(`delete from public.classroom_enrollments where classroom_id='${classA}' and student_id='${memberTeacher}';`) },
        () => { sql(`update public.classrooms set archived_at=clock_timestamp() where id='${classA}';`) },
        () => { sql(`update public.classrooms set teacher_id='${memberTeacher}' where id='${classA}';`) },
      ]) {
        const revoked = instrument(memberTeacher, classA, 'member', { beforePage: page, pageSize: 1, mutation })
        await assert.rejects(read(memberTeacher, classA, 'member', revoked.client, today, later), { statusCode: 403 })
        assert.equal(revoked.pages(), page)
        resetClass()
      }
    }
    process.stdout.write('PASS short-page completeness and committed owner transfer/member removal/archive/owner-precedence changes before first and second payload statements; accumulated pages never returned\n')

    const tighten = () => { sql(`update public.classrooms set lesson_plan_visibility='current_week' where id='${classA}';`) }
    const firstTighten = instrument(memberTeacher, classA, 'member', { beforePage: 1, mutation: tighten })
    assert.deepEqual(await read(memberTeacher, classA, 'member', firstTighten.client, today, later), {
      lesson_plans: [owner.lesson_plans.find(plan => plan.date === today)!], visibility: 'current_week', max_date: saturday,
    })
    const outOfWindow = instrument(memberTeacher, classA, 'member')
    assert.deepEqual(await read(memberTeacher, classA, 'member', outOfWindow.client, nextWeek, later), {
      lesson_plans: [], visibility: 'current_week', max_date: saturday,
    })
    assert(outOfWindow.pages() > 0, 'Even invisible ranges need current bound classroom evidence')
    resetClass()
    for (const page of [2, 4]) {
      const changed = instrument(memberTeacher, classA, 'member', { beforePage: page, pageSize: 1, mutation: tighten })
      await assert.rejects(read(memberTeacher, classA, 'member', changed.client, today, later), { statusCode: 503 })
      assert.equal(changed.pages(), page, 'Visibility change includes terminal empty page')
      resetClass()
    }
    const deletion = instrument(ownerStudent, classA, 'owner', { beforePage: 2,
      mutation: () => { sql(`delete from public.lesson_plans where classroom_id='${classA}' and date='2000-01-01';`) } })
    assert.equal((await read(ownerStudent, classA, 'owner', deletion.client)).lesson_plans.length, 1004)
    assert(deletion.cursors[1]?.startsWith('gt.'), 'Pagination uses keyset, not deletion-sensitive offsets')
    process.stdout.write('PASS current-statement visibility tightening, invisible ranges, mid-page/terminal visibility-change containment and prior-row deletion keyset stability\n')
  } finally {
    if (created) {
      sql(`begin;
        delete from public.effective_feature_entitlement_audit a using (values ${operationsSql}) fixture(operation_id,u)
          where a.operation_id=fixture.operation_id and a.subject_user_id=fixture.u
            and a.actor_ref='test:lesson-plan-read' and a.reason_code='lesson_plan_read_fixture'
            and a.feature_key='classrooms.create'
            and exists(select 1 from public.users u where u.id=fixture.u and u.email like '${tag}_%@example.invalid');
        delete from public.classrooms where id in (${classesSql}) and title like '${tag}%';
        delete from public.users where id=any(array[${idsSql}]) and email like '${tag}_%@example.invalid';
        commit;`)
      assert.equal(sql(`select
        (select count(*) from public.users where id=any(array[${idsSql}]))+
        (select count(*) from public.classrooms where id in (${classesSql}))+
        (select count(*) from public.lesson_plans where classroom_id in (${classesSql}))+
        (select count(*) from public.classroom_enrollments where student_id=any(array[${idsSql}]))+
        (select count(*) from public.effective_feature_entitlements where subject_user_id=any(array[${idsSql}]))+
        (select count(*) from public.account_plans where subject_user_id=any(array[${idsSql}]))+
        (select count(*) from public.account_plan_audit where subject_user_id=any(array[${idsSql}]))+
        (select count(*) from public.effective_feature_entitlement_audit where subject_user_id=any(array[${idsSql}])
          or operation_id in (select operation_id from (values ${operationsSql}) fixture(operation_id,u)));`), 'SET\nSET\n0')
      process.stdout.write('PASS exact synthetic fixture/live-state/audit cleanup; no hosted, migration, reset/reseed, real-account or AI change\n')
    }
  }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
