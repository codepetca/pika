// Local-only installed-SDK proof for the dormant contextual roster GET.
// This script creates synthetic rows on the exact local Pika database. Never run
// it against a hosted project. It neither changes purge rollout nor calls purge.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { readContextualClassroomRoster } from '../src/lib/server/contextual-classroom-roster-read'
import type { Database } from '../src/types/database'

type WireRow = Record<string, unknown>
type Collection = 'roster' | 'enrollments'
type Resolver = (actorId: string, classroomId: string, studentIds: string[]) => Promise<string[]>

async function main() {
  const container = 'supabase_db_pika'
  assert.equal(execFileSync('docker', ['inspect', container, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}'],
    { encoding: 'utf8' }).trim(), 'pika')
  assert.match(execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }), /:54322\s*$/m)
  const status = (() => {
    try {
      return JSON.parse(execFileSync('supabase', ['status', '-o', 'json'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
    } catch {
      // A failed command can attach captured credential-bearing stdout to its
      // Error. Neither that error nor malformed status JSON may reach the log.
      throw new Error('Unable to read local Supabase status safely')
    }
  })()
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
    'The reviewed local migration 234 must be installed')
  function state() {
    return JSON.parse(sql(`select jsonb_build_object(
      'users',(select count(*) from public.users),
      'classrooms',(select count(*) from public.classrooms),
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
  const tag = `rosterread_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  const people = [
    { label: 'owner_student', role: 'student' },
    { label: 'owner_teacher', role: 'teacher' },
    { label: 'member_student', role: 'student' },
    { label: 'member_teacher', role: 'teacher' },
    { label: 'outsider', role: 'teacher' },
    { label: 'bound', role: 'student' },
    { label: 'stale', role: 'student' },
    { label: 'teacher_learner', role: 'teacher' },
    { label: 'removed', role: 'student' },
    { label: 'foreign', role: 'student' },
  ].map(person => ({ ...person, id: randomUUID(), email: `${tag}_${person.label}@example.invalid` }))
  const byLabel = (label: string) => {
    const person = people.find(item => item.label === label)
    assert(person)
    return person
  }
  const ownerStudent = byLabel('owner_student').id
  const ownerTeacher = byLabel('owner_teacher').id
  const memberStudent = byLabel('member_student').id
  const memberTeacher = byLabel('member_teacher').id
  const outsider = byLabel('outsider').id
  const bound = byLabel('bound').id
  const stale = byLabel('stale').id
  const teacherLearner = byLabel('teacher_learner').id
  const removed = byLabel('removed').id
  const foreign = byLabel('foreign').id
  const classA = randomUUID(), classB = randomUUID(), emptyClass = randomUUID(), deletableClass = randomUUID()
  const classes = [
    { id: classA, owner: ownerStudent, label: 'A' },
    { id: classB, owner: ownerTeacher, label: 'B' },
    { id: emptyClass, owner: ownerStudent, label: 'empty' },
    { id: deletableClass, owner: ownerTeacher, label: 'deletable' },
  ]
  const classIds = classes.map(item => `'${item.id}'::uuid`).join(',')
  const fixtureUserIds = people.map(item => `'${item.id}'::uuid`).join(',')
  const entitlementOps = [ownerStudent, ownerTeacher].map(id => ({ id, operation: randomUUID() }))
  const operationValues = entitlementOps.map(item => `('${item.operation}'::uuid,'${item.id}'::uuid)`).join(',')
  const rows = {
    bound: randomUUID(), stale: randomUUID(), teacherLearner: randomUUID(), invitation: randomUUID(),
    removed: randomUUID(), foreign: randomUUID(), bInvitation: randomUUID(), deletable: randomUUID(),
    duplicateBound: randomUUID(),
  }
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
  const resolverDisabled: Resolver = async () => []
  const installed = createClient<Database>(status.API_URL, status.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const read = (actorId: string, classroomId: string, resolvePurgeAvailability: Resolver = resolverDisabled,
    supabase = installed) => readContextualClassroomRoster({ supabase, actorId, classroomId, resolvePurgeAvailability })

  type TraceOptions = {
    pageSize?: number
    before?: { collection: Collection; page: number; change: () => void }
    fail?: { collection: Collection; page: number }
    tamper?: (collection: Collection, page: number, body: unknown[], root: WireRow, firstId: string | null) => void
  }
  function trace(actorId: string, classroomId: string, options: TraceOptions = {}) {
    const pages: Record<Collection, number> = { roster: 0, enrollments: 0 }
    const cursors: Record<Collection, Array<string | null>> = { roster: [], enrollments: [] }
    const firstIds: Record<Collection, string | null> = { roster: null, enrollments: null }
    let preflights = 0
    const client = createClient<Database>(status.API_URL, status.SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        assert.equal(url.origin, 'http://127.0.0.1:54321')
        assert.equal(url.pathname, '/rest/v1/classrooms', 'No unbound collection, RPC, or fallback query')
        assert.equal(url.searchParams.get('id'), `eq.${classroomId}`)
        const select = url.searchParams.get('select') ?? ''
        const collection: Collection | null = select.includes('roster:') ? 'roster'
          : select.includes('enrollments:') ? 'enrollments' : null
        if (!collection) {
          preflights++
          assert.equal(preflights, 1, 'Exactly one classroom preflight')
          assert.equal(select.replaceAll(/\s/g, ''), 'id,teacher_id,archived_at')
          return fetch(url, init)
        }
        assert.equal(url.searchParams.get('teacher_id'), `eq.${actorId}`, 'Every payload is owner-bound')
        pages[collection]++
        const page = pages[collection]
        assert(page <= 15, 'Bounded keyset scan without retry/fallback')
        assert.equal(url.searchParams.get(`${collection}.order`), 'id.asc')
        assert.equal(url.searchParams.get(`${collection}.limit`), '1000')
        if (collection === 'roster') {
          assert.match(select, /roster:classroom_roster!classroom_roster_classroom_id_fkey\(/)
          assert.match(select, /binding:classroom_roster_student_bindings!classroom_roster_student_bindings_roster_id_fkey\(/)
          assert.equal(url.searchParams.get('roster.removed_at'), 'is.null')
          for (const field of ['id', 'classroom_id', 'email', 'student_number', 'first_name', 'last_name',
            'counselor_email', 'join_source', 'created_at', 'updated_at', 'removed_at']) {
            assert.match(select, new RegExp(`\\b${field}\\b`))
          }
        } else {
          assert.match(select, /enrollments:classroom_enrollments!classroom_enrollments_classroom_id_fkey\(/)
          assert.match(select, /student:users!classroom_enrollments_student_id_fkey\(id,email\)/)
        }
        const cursor = url.searchParams.get(`${collection}.id`)
        cursors[collection].push(cursor)
        if (page === 1) assert.equal(cursor, null)
        else assert.match(cursor ?? '', /^gt\.[0-9a-f-]{36}$/)
        if (options.before?.collection === collection && options.before.page === page) options.before.change()
        if (options.pageSize !== undefined) url.searchParams.set(`${collection}.limit`, String(options.pageSize))
        if (options.fail?.collection === collection && options.fail.page === page) {
          return new Response(JSON.stringify({ code: 'PGRST205', message: 'Synthetic missing schema' }), {
            status: 404, headers: { 'content-type': 'application/json' },
          })
        }
        const response = await fetch(url, init)
        if (!response.ok) return response
        // PostgREST emits an ARRAY even though supabase-js maybeSingle later returns
        // one object. Mutations must alter that actual wire shape to be effective.
        const body: unknown = await response.json()
        assert(Array.isArray(body), 'PostgREST wire response must be an array')
        const root = body[0] as WireRow | undefined
        if (root && Array.isArray(root[collection]) && root[collection].length && !firstIds[collection]) {
          firstIds[collection] = (root[collection][0] as { id: string }).id
        }
        if (root && options.tamper) options.tamper(collection, page, body, root, firstIds[collection])
        const headers = new Headers(response.headers)
        headers.delete('content-length')
        return new Response(JSON.stringify(body), { status: response.status, headers })
      } },
    })
    return { client, pages, cursors, preflights: () => preflights }
  }

  function resetB() {
    sql(`update public.classrooms set teacher_id='${ownerTeacher}',archived_at=null where id='${classB}';`)
  }

  try {
    // Provisioned users receive Free plan/audit rows through the installed
    // trigger. Owners get the normal manual creation entitlement RPC.
    sql(`begin;
      insert into public.users(id,email,role) values
        ${people.map(item => `('${item.id}',${quote(item.email)},'${item.role}')`).join(',')};
      insert into public.users(id,email,role)
        select gen_random_uuid(),${quote(`${tag}_bulk_`)}||n||'@example.invalid','student'
        from generate_series(1,1001) n;
      set local role service_role;
      select public.set_effective_feature_entitlement_v1(operation_id,u,'classrooms.create','manual',true,
        clock_timestamp(),null,4,'test:contextual-roster-read','${tag}',
        coalesce((select revision from public.effective_feature_entitlements
          where subject_user_id=u and feature_key='classrooms.create'),0))
        from (values ${operationValues}) fixture(operation_id,u);
      reset role;
      insert into public.classrooms(id,teacher_id,title,class_code) values
        ${classes.map(item => `('${item.id}','${item.owner}','${tag} ${item.label}','${tag}_${item.label}')`).join(',')};
      insert into public.classroom_roster(id,classroom_id,email,student_number,first_name,last_name,counselor_email,join_source) values
        ('${rows.bound}','${classA}',${quote(byLabel('bound').email)},'S-BOUND','Ada','Bound','counselor@example.invalid','csv'),
        ('${rows.stale}','${classA}',${quote(byLabel('stale').email)},null,'Stale','Bound',null,'manual'),
        ('${rows.teacherLearner}','${classA}',${quote(`  ${byLabel('teacher_learner').email.toUpperCase()}  `)},null,'Teacher','Learner',null,'open_join'),
        ('${rows.invitation}','${classA}',${quote(`${tag}_invited@example.invalid`)},null,'Invited','Only',null,'manual'),
        ('${rows.duplicateBound}','${classA}',${quote(`${tag}_duplicate_display@example.invalid`)},null,'Second','Bound',null,'manual'),
        ('${rows.removed}','${classA}',${quote(byLabel('removed').email)},null,'Removed','Student',null,'manual'),
        ('${rows.foreign}','${classB}',${quote(byLabel('foreign').email)},null,'Other','Class',null,'manual'),
        ('${rows.bInvitation}','${classB}',${quote(`${tag}_b_invited@example.invalid`)},null,'B','Invite',null,'manual'),
        ('${rows.deletable}','${deletableClass}',${quote(`${tag}_deletable@example.invalid`)},null,'Delete','Class',null,'manual');
      insert into public.classroom_roster(classroom_id,email,student_number,first_name,last_name,join_source)
        select '${classA}',email,'B-'||split_part(email,'_',3),'Bulk','Student','csv'
        from public.users where email like '${tag}_bulk_%@example.invalid';
      insert into public.classroom_enrollments(classroom_id,student_id) values
        ('${classA}','${memberTeacher}'),('${classA}','${bound}'),('${classA}','${stale}'),
        ('${classA}','${teacherLearner}'),('${classA}','${removed}'),
        ('${classB}','${memberStudent}'),('${classB}','${foreign}'),
        ('${deletableClass}','${memberStudent}');
      insert into public.classroom_enrollments(classroom_id,student_id)
        select '${classA}',id from public.users where email like '${tag}_bulk_%@example.invalid';
      -- The installed schema permits a second active roster row for one
      -- learner. Bind that distinct display email explicitly, without a
      -- trigger bypass or schema change.
      insert into public.classroom_roster_student_bindings(roster_id,classroom_id,student_id)
        values('${rows.duplicateBound}','${classA}','${bound}');
      update public.classroom_roster set email=${quote(`${tag}_display_renamed@example.invalid`)} where id='${rows.bound}';
      update public.users set email=${quote(`${tag}_account_renamed@example.invalid`)} where id='${bound}';
      delete from public.classroom_enrollments where classroom_id='${classA}' and student_id='${stale}';
      set local role service_role;
      select public.remove_classroom_students_preserving_data('${ownerStudent}'::uuid,'${classA}'::uuid,
        array['${rows.removed}'::uuid]);
      reset role;
      commit;`)
    assert.equal(sql(`select count(*) from public.classroom_roster_student_bindings
      where classroom_id='${classA}' and roster_id in
      (select id from public.classroom_roster where classroom_id='${classA}' and email like '${tag}_bulk_%@example.invalid');`),
    '1001', 'The installed triggers must produce all 1001 bulk stable bindings')
    assert.equal(sql(`select count(*) from public.classroom_roster_student_bindings where roster_id='${rows.teacherLearner}';`),
      '0', 'Teacher-valued learner has no stable binding from the existing trigger')
    assert.equal(sql(`select count(*) from public.classroom_roster where id='${rows.removed}' and removed_at is not null;`),
      '1', 'The preserving removal RPC must produce a retained, hidden row')
    if (process.argv.includes('--verify-cleanup-after-fixture')) throw new Error('Forced post-fixture cleanup proof')

    const bulkTrace = trace(ownerStudent, classA)
    const a = await read(ownerStudent, classA, resolverDisabled, bulkTrace.client)
    assert.deepEqual(Object.keys(a), ['roster', 'student_purge_enabled_ids'])
    assert.deepEqual(a.student_purge_enabled_ids, [])
    assert.equal(a.roster.length, 1006, '1001 bulk + two bound rows + stale + teacher learner + invitation')
    assert.equal(bulkTrace.pages.roster, 3, '1006 roster rows require two data pages and terminal empty page')
    assert.equal(bulkTrace.pages.enrollments, 3, '1001 bulk plus special enrollments require terminal empty page')
    assert.equal(new Set(a.roster.map(row => row.id)).size, a.roster.length)
    assert(!a.roster.some(row => row.id === rows.removed || row.id === rows.foreign), 'Removed/foreign rows stay hidden')
    const boundRow = a.roster.find(row => row.id === rows.bound)
    assert(boundRow)
    assert.deepEqual(boundRow, {
      id: rows.bound, email: `${tag}_display_renamed@example.invalid`, student_number: 'S-BOUND',
      first_name: 'Ada', last_name: 'Bound', counselor_email: 'counselor@example.invalid',
      join_source: 'csv', created_at: boundRow.created_at, updated_at: boundRow.updated_at,
      joined: true, student_id: bound, joined_at: boundRow.joined_at,
    })
    assert.match(boundRow.created_at, /^\d{4}-\d\d-\d\dT/)
    assert.match(boundRow.updated_at, /^\d{4}-\d\d-\d\dT/)
    assert.match(boundRow.joined_at ?? '', /^\d{4}-\d\d-\d\dT/)
    assert.equal(a.roster.find(row => row.id === rows.duplicateBound)?.student_id, bound,
      'A second valid binding retains the same stable learner identity')
    assert.equal(a.roster.find(row => row.id === rows.duplicateBound)?.joined, true)
    assert.deepEqual(a.roster.find(row => row.id === rows.stale)?.joined, false)
    assert.equal(a.roster.find(row => row.id === rows.stale)?.student_id, null)
    assert.equal(a.roster.find(row => row.id === rows.teacherLearner)?.joined, true,
      'An enrolled teacher-valued learner is not excluded by global role')
    assert.equal(a.roster.find(row => row.id === rows.teacherLearner)?.student_id, null,
      'Email-only matching never becomes stable mutation authority')
    assert.equal(a.roster.find(row => row.id === rows.invitation)?.joined, false)
    assert.equal(a.roster.find(row => row.id === rows.invitation)?.joined_at, null)
    assert.equal(a.roster.filter(row => row.student_number?.startsWith('B-')).length, 1001)
    const b = await read(ownerTeacher, classB)
    assert.deepEqual(b.roster.map(row => row.id).sort(), [rows.foreign, rows.bInvitation].sort())
    assert.equal(b.roster.find(row => row.id === rows.foreign)?.student_id, foreign)
    assert.deepEqual(await read(ownerStudent, emptyClass), { roster: [], student_purge_enabled_ids: [] })
    await assert.rejects(read(memberTeacher, classA), { statusCode: 403 })
    await assert.rejects(read(memberStudent, classB), { statusCode: 403 })
    await assert.rejects(read(outsider, classA), { statusCode: 403 })
    await assert.rejects(read(ownerTeacher, classA), { statusCode: 403 })
    await assert.rejects(read(ownerStudent, randomUUID()), { statusCode: 404 })
    sql(`update public.classrooms set archived_at=clock_timestamp() where id='${classB}';`)
    assert.equal((await read(ownerTeacher, classB)).roster.length, 2)
    resetB()
    process.stdout.write('PASS live local SDK pagination, nested bindings, both global-role owners, mixed learner, removed/foreign isolation, archive and projection\n')

    const seenIds: string[][] = []
    const enabled: Resolver = async (actorId, classroomId, studentIds) => {
      assert.equal(actorId, ownerStudent)
      assert.equal(classroomId, classA)
      assert(!studentIds.includes(stale) && !studentIds.includes(teacherLearner))
      assert.equal(new Set(studentIds).size, studentIds.length, 'Duplicate roster bindings produce one availability candidate')
      seenIds.push(studentIds)
      return studentIds
    }
    const all = await read(ownerStudent, classA, enabled)
    assert.equal(all.student_purge_enabled_ids.length, 1002, 'Only joined, stable IDs are availability candidates')
    assert.equal(seenIds.length, 1)
    const canary = await read(ownerStudent, classA, async () => [bound])
    assert.deepEqual(canary.student_purge_enabled_ids, [bound])
    assert.deepEqual((await read(ownerStudent, classA, resolverDisabled)).student_purge_enabled_ids, [])
    for (const invalid of [[randomUUID()], [bound, bound], ['bad-id']]) {
      await assert.rejects(read(ownerStudent, classA, async () => invalid), { statusCode: 503 })
    }
    await assert.rejects(read(ownerStudent, classA, async () => { throw new Error('Synthetic availability failure') }),
      { statusCode: 503 })
    process.stdout.write('PASS controlled disabled/canary/enabled availability and fail-closed invalid resolver output\n')

    // Shortening only the transported limit forces every actual helper page to
    // advance its UUID cursor. No offset and no unbound requery is allowed.
    const shortB = trace(ownerTeacher, classB, { pageSize: 1 })
    assert.equal((await read(ownerTeacher, classB, resolverDisabled, shortB.client)).roster.length, 2)
    assert.equal(shortB.pages.roster, 3)
    assert.equal(shortB.pages.enrollments, 3)
    assert(shortB.cursors.roster[1]?.startsWith('gt.') && shortB.cursors.roster[2]?.startsWith('gt.'))
    assert(shortB.cursors.enrollments[1]?.startsWith('gt.') && shortB.cursors.enrollments[2]?.startsWith('gt.'))

    for (const collection of ['roster', 'enrollments'] as const) {
      for (const page of [1, 2, 3]) {
        const revoked = trace(ownerTeacher, classB, { pageSize: 1, before: { collection, page,
          change: () => { sql(`update public.classrooms set teacher_id='${ownerStudent}' where id='${classB}';`) },
        } })
        await assert.rejects(read(ownerTeacher, classB, resolverDisabled, revoked.client), { statusCode: 403 })
        assert.equal(revoked.pages[collection], page)
        resetB()
      }
    }
    for (const collection of ['roster', 'enrollments'] as const) {
      const missingSchema = trace(ownerTeacher, classB, { pageSize: 1, fail: { collection, page: 2 } })
      await assert.rejects(read(ownerTeacher, classB, resolverDisabled, missingSchema.client), { statusCode: 503 })
      assert.equal(missingSchema.pages[collection], 2)
    }
    process.stdout.write('PASS owner transfer before first/later/terminal page of both collections and SDK errors without fallback\n')

    const mutations: Array<(collection: Collection, page: number, body: unknown[], root: WireRow, firstId: string | null) => void> = [
      (collection, page, _body, root) => { if (collection === 'roster' && page === 2) root.roster = null },
      (collection, page, _body, root) => { if (collection === 'roster' && page === 2) root.teacher_id = ownerStudent },
      (collection, page, _body, root) => { if (collection === 'roster' && page === 2) root.id = classA },
      (collection, page, _body, root, firstId) => {
        if (collection === 'roster' && page === 2) (root.roster as WireRow[])[0].id = firstId
      },
      (collection, page, _body, root) => {
        if (collection === 'roster' && page === 2) (root.roster as WireRow[])[0].id = '00000000-0000-4000-8000-000000000001'
      },
      (collection, page, _body, root) => {
        if (collection === 'roster' && page === 2) (root.roster as WireRow[])[0].classroom_id = classA
      },
      (collection, page, _body, root) => {
        if (collection === 'roster' && page === 2) (root.roster as WireRow[])[0].email = null
      },
      (collection, page, _body, root) => {
        if (collection === 'roster' && page === 2) (root.roster as WireRow[])[0].extra = 'unexpected'
      },
      (collection, page, _body, root) => {
        if (collection === 'enrollments' && page === 2) root.enrollments = null
      },
      (collection, page, _body, root, firstId) => {
        if (collection === 'enrollments' && page === 2) (root.enrollments as WireRow[])[0].id = firstId
      },
      (collection, page, _body, root) => {
        if (collection === 'enrollments' && page === 2) (root.enrollments as WireRow[])[0].id = '00000000-0000-4000-8000-000000000001'
      },
      (collection, page, _body, root) => {
        if (collection === 'enrollments' && page === 2) (root.enrollments as WireRow[])[0].student_id = classA
      },
      (collection, page, _body, root) => {
        if (collection === 'enrollments' && page === 2) (root.enrollments as WireRow[])[0].student = { id: classA, email: byLabel('foreign').email }
      },
      (collection, page, body) => { if (collection === 'roster' && page === 2) body.push({ id: classB }) },
    ]
    for (const tamper of mutations) {
      const corrupt = trace(ownerTeacher, classB, { pageSize: 1, tamper })
      await assert.rejects(read(ownerTeacher, classB, resolverDisabled, corrupt.client), { statusCode: 503 })
    }
    const badBinding = trace(ownerStudent, classA, { tamper: (collection, page, _body, root) => {
      if (collection !== 'roster' || page !== 1) return
      const row = (root.roster as WireRow[]).find(item => item.binding !== null)
      assert(row, 'The first 1000 roster rows contain a real binding')
      const binding = row.binding as WireRow
      binding.classroom_id = classB
    } })
    await assert.rejects(read(ownerStudent, classA, resolverDisabled, badBinding.client), { statusCode: 503 })
    process.stdout.write('PASS actual-array wire tampering: duplicate/substituted/malformed pages and nested identity failure\n')

    // Deletion before the first payload and before each terminal empty page
    // must not be mistaken for an authorized empty collection.
    for (const collection of ['roster', 'enrollments'] as const) {
      for (const page of [1, 2]) {
        if (collection !== 'roster' || page !== 1) {
          // Recreate only this exact disposable synthetic class after deletion.
          sql(`insert into public.classrooms(id,teacher_id,title,class_code)
            values('${deletableClass}','${ownerTeacher}','${tag} deletable','${tag}_deletable');
            insert into public.classroom_roster(id,classroom_id,email)
            values('${rows.deletable}','${deletableClass}',${quote(`${tag}_deletable@example.invalid`)});
            insert into public.classroom_enrollments(classroom_id,student_id)
            values('${deletableClass}','${memberStudent}');`)
        }
        const deleted = trace(ownerTeacher, deletableClass, { pageSize: 1, before: { collection, page,
          change: () => { sql(`delete from public.classrooms where id='${deletableClass}';`) },
        } })
        await assert.rejects(read(ownerTeacher, deletableClass, resolverDisabled, deleted.client), { statusCode: 403 })
        assert.equal(deleted.pages[collection], page)
      }
    }
    process.stdout.write('PASS deleted classroom denied before first and terminal roster/enrollment payload\n')
  } finally {
    // Fixture identity is constrained by both random IDs and the nonce emails.
    // Cleanup runs even after partial setup, failed assertions, or forced proof.
    sql(`begin;
      create temp table roster_fixture_provision_ops(operation_id uuid,subject_user_id uuid,
        primary key(operation_id,subject_user_id)) on commit drop;
      insert into roster_fixture_provision_ops
        select audit.operation_id,audit.subject_user_id
        from public.account_plan_audit audit join public.users fixture
          on fixture.id=audit.subject_user_id
        where fixture.email like '${tag}_%@example.invalid'
          and audit.actor_ref='system:user-provisioning'
          and audit.reason_code='default_free_account_provisioning';
      delete from public.effective_feature_entitlement_audit audit using (values ${operationValues}) fixture(operation_id,u)
        where audit.operation_id=fixture.operation_id and audit.subject_user_id=fixture.u
          and audit.actor_ref='test:contextual-roster-read' and audit.reason_code='${tag}'
          and audit.feature_key='classrooms.create';
      delete from public.effective_feature_entitlement_audit audit using roster_fixture_provision_ops operation
        where audit.operation_id=operation.operation_id and audit.subject_user_id=operation.subject_user_id
          and audit.actor_ref='system:user-provisioning' and audit.reason_code='default_free_account_provisioning'
          and audit.feature_key='classrooms.create';
      delete from public.account_plan_audit audit using roster_fixture_provision_ops operation
        where audit.operation_id=operation.operation_id and audit.subject_user_id=operation.subject_user_id
          and audit.actor_ref='system:user-provisioning' and audit.reason_code='default_free_account_provisioning';
      delete from public.classrooms fixture where fixture.id in (${classIds})
        and fixture.title like '${tag} %' and fixture.class_code like '${tag}_%';
      delete from public.users fixture where
        (fixture.id in (${fixtureUserIds}) or fixture.email like '${tag}_bulk_%@example.invalid')
        and (fixture.email like '${tag}_%@example.invalid'
          or fixture.id='${bound}' and fixture.email=${quote(`${tag}_account_renamed@example.invalid`)});
      commit;`)
    assert.equal(sql(`select
      (select count(*) from public.users where email like '${tag}_%@example.invalid')+
      (select count(*) from public.classrooms where id in (${classIds}))+
      (select count(*) from public.classroom_enrollments where classroom_id in (${classIds}))+
      (select count(*) from public.classroom_roster where classroom_id in (${classIds}))+
      (select count(*) from public.classroom_roster_student_bindings where classroom_id in (${classIds}))+
      (select count(*) from public.student_profiles where user_id in (${fixtureUserIds}))+
      (select count(*) from public.classroom_archive_revisions where classroom_id in (${classIds}))+
      (select count(*) from public.account_plans where subject_user_id in (${fixtureUserIds})
        or subject_user_id in (select id from public.users where email like '${tag}_bulk_%@example.invalid'))+
      (select count(*) from public.account_plan_audit where subject_user_id in (${fixtureUserIds}))+
      (select count(*) from public.effective_feature_entitlements where subject_user_id in (${fixtureUserIds}))+
      (select count(*) from public.effective_feature_entitlement_audit where subject_user_id in (${fixtureUserIds})
        or operation_id in (select operation_id from (values ${operationValues}) fixture(operation_id,u)));`),
    '0', 'No synthetic fixture rows may remain')
    assert.deepEqual(state(), baseline, 'All relevant global table counts return to baseline')
    process.stdout.write('PASS exact synthetic roster fixture cleanup, zero residual rows and global baseline counts\n')
  }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
