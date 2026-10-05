// Local-only actual SDK/PostgREST proof for the dormant linked Blueprint Materials read.
// Run only against the exact Pika Docker binding; never applies schema or contacts a hosted API.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { ApiError } from '../src/lib/api-error'
import { hashCanonicalJson } from '../src/lib/server/course-blueprint-versions'
import { readContextualClassroomBlueprintMaterials } from '../src/lib/server/contextual-classroom-blueprint-material-read'
import type { Database } from '../src/types/database'

const container = 'supabase_db_pika'
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
const json = (value: unknown) => `${quote(JSON.stringify(value))}::jsonb`
const ids = (values: string[]) => values.map(quote).join(',')

async function main() {
  assert.equal(execFileSync('docker', ['inspect', container, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}'],
    { encoding: 'utf8' }).trim(), 'pika')
  assert.match(execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }), /:54322\s*$/m)
  const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })) as { API_URL: string; SERVICE_ROLE_KEY: string }
  assert.equal(status.API_URL, 'http://127.0.0.1:54321')
  assert.equal(typeof status.SERVICE_ROLE_KEY, 'string')
  const service = createClient<Database>(status.API_URL, status.SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } })
  function sql(statement: string) {
    return execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt',
      '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], {
      input: `set statement_timeout='45s'; set lock_timeout='5s'; ${statement}`,
      encoding: 'utf8', timeout: 50_000, maxBuffer: 6_000_000,
    }).trim()
  }
  assert.equal(sql("select exists(select 1 from supabase_migrations.schema_migrations where version='234');"), 't',
    'Use only the independently reviewed local migration 234 schema')
  function globalCounts() {
    return JSON.parse(sql(`select jsonb_build_object(
      'users',(select count(*) from public.users),
      'classrooms',(select count(*) from public.classrooms),
      'enrollments',(select count(*) from public.classroom_enrollments),
      'materials',(select count(*) from public.classwork_materials),
      'blueprints',(select count(*) from public.course_blueprints),
      'versions',(select count(*) from public.course_blueprint_versions),
      'draft_materials',(select count(*) from public.course_blueprint_materials),
      'guidance_revisions',(select count(*) from public.course_blueprint_authoring_guidance_revisions),
      'archive_revisions',(select count(*) from public.classroom_archive_revisions),
      'plans',(select count(*) from public.account_plans),
      'plan_audit',(select count(*) from public.account_plan_audit),
      'entitlements',(select count(*) from public.effective_feature_entitlements),
      'entitlement_audit',(select count(*) from public.effective_feature_entitlement_audit));`))
  }
  const baseline = globalCounts()
  const tag = `bp_matread_${randomUUID().slice(0, 8)}`
  const studentOwner = randomUUID(), teacherOwner = randomUUID(), member = randomUUID(), outsider = randomUUID()
  const people = [
    [studentOwner, 'student_owner', 'student'], [teacherOwner, 'teacher_owner', 'teacher'],
    [member, 'member', 'student'], [outsider, 'outsider', 'teacher'],
  ] as const
  const identities = people.map(([id, label]) => `(${quote(id)}::uuid,${quote(`${tag}_${label}@example.invalid`)})`).join(',')
  const personIds = people.map(([id]) => id)
  const entitlementOps = [studentOwner, teacherOwner].map(subject => ({ subject, operation: randomUUID() }))
  const entitlementValues = entitlementOps.map(({ subject, operation }) =>
    `(${quote(operation)}::uuid,${quote(subject)}::uuid)`).join(',')
  const classroomA = randomUUID(), classroomB = randomUUID(), noLink = randomUUID()
  const classes = [
    [classroomA, 'A', studentOwner], [classroomB, 'B', teacherOwner], [noLink, 'no_link', studentOwner],
  ] as const
  const classIds = classes.map(([id]) => id)
  const blueprintA = randomUUID(), blueprintB = randomUUID(), blueprintA2 = randomUUID()
  const blueprintIds = [blueprintA, blueprintB, blueprintA2]
  const draftMaterial = randomUUID()
  const frozenVersion = randomUUID(), latestVersion = randomUUID(), versionB = randomUUID(), versionA2 = randomUUID()
  const material0 = { artifact_id: randomUUID(), title: 'First saved', content_markdown: '# First', position: 0 }
  const material1 = { artifact_id: randomUUID(), title: 'Second saved', content_markdown: '# Second', position: 1 }
  const material2 = { artifact_id: randomUUID(), title: 'Third saved', content_markdown: '# Third', position: 2 }
  const frozen = { materials: [{ ...material0, title: 'Frozen class content' }] }
  const middle = { materials: [] }
  const latest = { materials: [material2, material0, material1], authoring_guidance: { teacher_private: 'never return' },
    assessments: [{ answer_key: 'never return' }] }
  const other = { materials: [{ ...material1, title: 'Rebound Blueprint' }] }
  const secondOwner = { materials: [{ ...material2, title: 'Teacher owner saved' }] }
  const versionValues = (id: string, blueprint: string, number: number, snapshot: unknown, creator: string,
    sourceRevision = number) =>
    `(${quote(id)},${quote(blueprint)},${number},${sourceRevision},${json(snapshot)},${quote(hashCanonicalJson(snapshot))},${quote(creator)})`
  const bulkVersionValues = `select gen_random_uuid(),${quote(blueprintA)}::uuid,n,n,${json(middle)},
    ${quote(hashCanonicalJson(middle))},${quote(studentOwner)}::uuid from generate_series(2,1000) n`
  const versionIds: string[] = [frozenVersion, latestVersion, versionB, versionA2]
  const read = (actorId: string, classroomId: string, supabase = service) =>
    readContextualClassroomBlueprintMaterials({ supabase, actorId, classroomId })
  const statusIs = (code: number) => (error: unknown) => error instanceof ApiError && error.statusCode === code

  type Payload = Record<string, unknown>
  type TraceOptions = { beforePayload?: () => void; alter?: (row: Payload) => void; failPayload?: boolean }
  function trace(actorId: string, classroomId: string, options: TraceOptions = {}) {
    let preflights = 0, payloads = 0
    const client = createClient<Database>(status.API_URL, status.SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (input, init) => {
        const url = new URL(String(input))
        assert.equal(url.pathname, '/rest/v1/classrooms', 'No independent version, Blueprint or RPC payload query')
        assert.equal(url.searchParams.get('id'), `eq.${classroomId}`)
        const select = url.searchParams.get('select')
        if (select === 'id,teacher_id') {
          preflights++
          assert.equal(preflights, 1)
          return fetch(url, init)
        }
        payloads++
        assert.equal(payloads, 1, 'One classroom-rooted payload statement, with no retry/fallback')
        assert.equal(url.searchParams.get('teacher_id'), `eq.${actorId}`)
        assert.equal(url.searchParams.get('blueprint.teacher_id'), `eq.${actorId}`)
        assert.equal(url.searchParams.get('blueprint.versions.order'), 'version_number.desc')
        assert.equal(url.searchParams.get('blueprint.versions.limit'), '1')
        assert.equal(select, 'id,teacher_id,source_blueprint_id,blueprint:course_blueprints!classrooms_source_blueprint_id_fkey(id,teacher_id,versions:course_blueprint_versions!course_blueprint_versions_course_blueprint_id_fkey(id,course_blueprint_id,version_number,snapshot_json))')
        assert(!select?.includes('source_blueprint_version_id'), 'Frozen classroom version is not this read source')
        options.beforePayload?.()
        if (options.failPayload) return new Response(JSON.stringify({ code: 'PGRST205', message: 'Synthetic missing schema' }),
          { status: 404, headers: { 'content-type': 'application/json' } })
        const response = await fetch(url, init)
        if (!response.ok || !options.alter) return response
        // maybeSingle GET uses JSON arrays on the wire; the SDK unwraps after fetch.
        // Alter the actual row rather than adding JSON-invisible array properties.
        const body = await response.json() as Payload | Payload[] | null
        if (Array.isArray(body)) {
          assert.equal(body.length, 1, 'The corruption fixture must target exactly one current classroom')
          options.alter(body[0])
        } else if (body) options.alter(body)
        const headers = new Headers(response.headers)
        headers.delete('content-length')
        return new Response(JSON.stringify(body), { status: response.status, headers })
      } },
    })
    return { client, preflights: () => preflights, payloads: () => payloads }
  }
  function currentVersion(blueprint: string) {
    const raw = sql(`select row_to_json(v) from (
      select id,course_blueprint_id,version_number,source_draft_revision,snapshot_json,snapshot_sha256,created_by
      from public.course_blueprint_versions where course_blueprint_id=${quote(blueprint)}
      order by version_number desc limit 1) v;`)
    return JSON.parse(raw) as { id: string; course_blueprint_id: string; version_number: number;
      source_draft_revision: number; snapshot_json: unknown; snapshot_sha256: string; created_by: string }
  }
  function appendVersion(blueprint: string, owner: string, number: number, snapshot: unknown) {
    const id = randomUUID()
    versionIds.push(id)
    // A real Draft revision advances between saves; keep the fixture's immutable
    // Version parent, source revision and canonical digest mutually consistent.
    sql(`update public.course_blueprints set title=${quote(`${tag} Draft revision for Version ${number}`)}
      where id=${quote(blueprint)} and teacher_id=${quote(owner)};`)
    const sourceRevision = Number(sql(`select content_revision from public.course_blueprints
      where id=${quote(blueprint)} and teacher_id=${quote(owner)};`))
    assert(Number.isSafeInteger(sourceRevision) && sourceRevision > number)
    sql(`insert into public.course_blueprint_versions(id,course_blueprint_id,version_number,
      source_draft_revision,snapshot_json,snapshot_sha256,created_by) values
      ${versionValues(id, blueprint, number, snapshot, owner, sourceRevision)};`)
    const saved = currentVersion(blueprint)
    assert.equal(saved.id, id)
    assert.equal(saved.course_blueprint_id, blueprint)
    assert.equal(saved.created_by, owner)
    assert.equal(saved.source_draft_revision, sourceRevision)
    assert.equal(saved.snapshot_sha256, hashCanonicalJson(saved.snapshot_json))
    return id
  }
  try {
    sql(`begin;
      insert into public.users(id,email,role) values
        ${people.map(([id, label, role]) => `(${quote(id)},${quote(`${tag}_${label}@example.invalid`)},${quote(role)})`).join(',')};
      set local role service_role;
      select public.set_effective_feature_entitlement_v1(operation,u,'classrooms.create','manual',true,
        clock_timestamp(),null,4,'test:blueprint-material-read',${quote(tag)},
        coalesce((select revision from public.effective_feature_entitlements where subject_user_id=u and feature_key='classrooms.create'),0))
        from (values ${entitlementValues}) fixture(operation,u);
      reset role;
      insert into public.course_blueprints(id,teacher_id,title) values
        (${quote(blueprintA)},${quote(studentOwner)},${quote(`${tag} Blueprint A`)}),
        (${quote(blueprintB)},${quote(teacherOwner)},${quote(`${tag} Blueprint B`)}),
        (${quote(blueprintA2)},${quote(studentOwner)},${quote(`${tag} Blueprint A2`)});
      insert into public.course_blueprint_versions(id,course_blueprint_id,version_number,
        source_draft_revision,snapshot_json,snapshot_sha256,created_by) values
        ${versionValues(frozenVersion, blueprintA, 1, frozen, studentOwner)},
        ${versionValues(latestVersion, blueprintA, 1001, latest, studentOwner)},
        ${versionValues(versionB, blueprintB, 1, secondOwner, teacherOwner)},
        ${versionValues(versionA2, blueprintA2, 1, other, studentOwner)};
      insert into public.course_blueprint_versions(id,course_blueprint_id,version_number,
        source_draft_revision,snapshot_json,snapshot_sha256,created_by) ${bulkVersionValues};
      update public.course_blueprints set content_revision=1001,latest_version_number=1001
        where id=${quote(blueprintA)};
      update public.course_blueprints set latest_version_number=1
        where id in (${quote(blueprintB)},${quote(blueprintA2)});
      insert into public.course_blueprint_materials(id,course_blueprint_id,artifact_id,title,content_markdown,position)
        values(${quote(draftMaterial)},${quote(blueprintA)},${quote(randomUUID())},
          'Unsaved Draft only','# Never saved',0);
      insert into public.classrooms(id,teacher_id,title,class_code,source_blueprint_id,source_blueprint_version_id) values
        (${quote(classroomA)},${quote(studentOwner)},${quote(`${tag} A`)},${quote(`${tag}_a`)},${quote(blueprintA)},${quote(frozenVersion)}),
        (${quote(classroomB)},${quote(teacherOwner)},${quote(`${tag} B`)},${quote(`${tag}_b`)},${quote(blueprintB)},${quote(versionB)}),
        (${quote(noLink)},${quote(studentOwner)},${quote(`${tag} no_link`)},${quote(`${tag}_n`)},null,null);
      insert into public.classroom_enrollments(classroom_id,student_id) values
        (${quote(classroomA)},${quote(member)}),(${quote(classroomB)},${quote(member)});
      commit;`)
    if (process.argv.includes('--verify-cleanup-after-fixture')) throw new Error('Forced post-fixture cleanup proof')

    assert.equal(sql(`select count(*) from public.course_blueprint_versions where course_blueprint_id=${quote(blueprintA)};`), '1001')
    assert.equal(sql(`select content_revision from public.course_blueprints where id=${quote(blueprintA)};`), '1002')
    assert.equal(currentVersion(blueprintA).snapshot_sha256, hashCanonicalJson(latest))
    const aTrace = trace(studentOwner, classroomA)
    assert.deepEqual(await read(studentOwner, classroomA, aTrace.client), {
      materials: { version_id: latestVersion, version_number: 1001, materials: [material0, material1, material2] },
    })
    assert.equal(aTrace.preflights(), 1)
    assert.equal(aTrace.payloads(), 1)
    assert.deepEqual(await read(teacherOwner, classroomB), {
      materials: { version_id: versionB, version_number: 1, materials: secondOwner.materials },
    })
    sql(`delete from public.course_blueprint_materials where id=${quote(draftMaterial)}
      and course_blueprint_id=${quote(blueprintA)};`)
    assert.equal((await read(studentOwner, classroomA)).materials?.version_id, latestVersion,
      'Deleting an unsaved Draft item cannot remove saved Version material')
    assert.deepEqual(await read(studentOwner, noLink), { materials: null })
    await assert.rejects(read(member, classroomA), statusIs(403))
    await assert.rejects(read(member, classroomB), statusIs(403))
    await assert.rejects(read(outsider, classroomA), statusIs(403))
    await assert.rejects(read(studentOwner, randomUUID()), statusIs(404))
    sql(`update public.classrooms set archived_at=clock_timestamp() where id=${quote(classroomA)};`)
    assert.equal((await read(studentOwner, classroomA)).materials?.version_id, latestVersion)
    sql(`update public.classrooms set archived_at=null where id=${quote(classroomA)};`)
    process.stdout.write('PASS actual SDK nested 1001-version latest limit, frozen/Draft exclusion, both global-role owners, no-link, archive and denials\n')

    const unlink = trace(studentOwner, classroomA, { beforePayload: () => {
      sql(`update public.classrooms set source_blueprint_id=null,source_blueprint_version_id=null where id=${quote(classroomA)};`)
    } })
    assert.deepEqual(await read(studentOwner, classroomA, unlink.client), { materials: null })
    assert.equal(unlink.payloads(), 1)
    sql(`update public.classrooms set source_blueprint_id=${quote(blueprintA)},source_blueprint_version_id=${quote(frozenVersion)}
      where id=${quote(classroomA)};`)
    const rebound = trace(studentOwner, classroomA, { beforePayload: () => {
      sql(`update public.classrooms set source_blueprint_id=${quote(blueprintA2)},source_blueprint_version_id=${quote(versionA2)}
        where id=${quote(classroomA)};`)
    } })
    assert.deepEqual(await read(studentOwner, classroomA, rebound.client), {
      materials: { version_id: versionA2, version_number: 1, materials: other.materials },
    })
    sql(`update public.classrooms set source_blueprint_id=${quote(blueprintA)},source_blueprint_version_id=${quote(frozenVersion)}
      where id=${quote(classroomA)};`)
    const transferredClass = trace(studentOwner, classroomA, { beforePayload: () => {
      sql(`update public.classrooms set teacher_id=${quote(teacherOwner)} where id=${quote(classroomA)};`)
    } })
    await assert.rejects(read(studentOwner, classroomA, transferredClass.client), statusIs(403))
    assert.equal(transferredClass.payloads(), 1)
    sql(`update public.classrooms set teacher_id=${quote(studentOwner)} where id=${quote(classroomA)};`)
    const transferredBlueprint = trace(studentOwner, classroomA, { beforePayload: () => {
      sql(`update public.course_blueprints set teacher_id=${quote(teacherOwner)} where id=${quote(blueprintA)};`)
    } })
    await assert.rejects(read(studentOwner, classroomA, transferredBlueprint.client), statusIs(404))
    assert.equal(transferredBlueprint.payloads(), 1)
    sql(`update public.course_blueprints set teacher_id=${quote(studentOwner)} where id=${quote(blueprintA)};`)
    process.stdout.write('PASS payload statement uses current class owner, source unlink/rebind and linked Blueprint owner\n')

    function blueprint(row: Payload): Payload { return row.blueprint as Payload }
    function version(row: Payload): Payload { return (blueprint(row).versions as Payload[])[0] }
    const corruptions: Array<(row: Payload) => void> = [
      row => { row.id = randomUUID() },
      row => { row.teacher_id = teacherOwner },
      row => { row.source_blueprint_id = blueprintA2 },
      row => { blueprint(row).id = blueprintA2 },
      row => { blueprint(row).teacher_id = teacherOwner },
      row => { version(row).course_blueprint_id = blueprintA2 },
      row => { blueprint(row).versions = [] },
      row => { (blueprint(row).versions as Payload[]).push(version(row)) },
      row => { version(row).snapshot_json = { materials: null } },
      row => { version(row).snapshot_json = null },
      row => { version(row).version_number = '1001' },
      row => { blueprint(row).versions = 'malformed' },
      row => { version(row).snapshot_json = { materials: [{ ...material0, content_markdown: 7 }] } },
    ]
    for (const alter of corruptions) {
      const bad = trace(studentOwner, classroomA, { alter })
      await assert.rejects(read(studentOwner, classroomA, bad.client), statusIs(503))
      assert.equal(bad.payloads(), 1)
    }
    const missingSchema = trace(studentOwner, classroomA, { failPayload: true })
    await assert.rejects(read(studentOwner, classroomA, missingSchema.client), statusIs(503))
    assert.equal(missingSchema.payloads(), 1)
    process.stdout.write('PASS substituted SDK payload identities, malformed snapshots and schema error fail closed without fallback\n')

    const malformed = appendVersion(blueprintA, studentOwner, 1002, { materials: null })
    await assert.rejects(read(studentOwner, classroomA), statusIs(503))
    assert.equal(currentVersion(blueprintA).id, malformed)
    const historical = appendVersion(blueprintA, studentOwner, 1003, { historical: 'pre-materials' })
    assert.deepEqual(await read(studentOwner, classroomA), {
      materials: { version_id: historical, version_number: 1003, materials: [] },
    })
    const fiveHundred = Array.from({ length: 500 }, (_, position) => ({
      artifact_id: randomUUID(), title: `Saved ${position}`, content_markdown: '', position,
    }))
    const boundary = appendVersion(blueprintA, studentOwner, 1004, { materials: [...fiveHundred].reverse() })
    const exact = await read(studentOwner, classroomA)
    assert.equal(exact.materials?.version_id, boundary)
    assert.deepEqual(exact.materials?.materials, fiveHundred)
    appendVersion(blueprintA, studentOwner, 1005, { materials: [...fiveHundred, {
      artifact_id: randomUUID(), title: 'One too many', content_markdown: '', position: 500,
    }] })
    await assert.rejects(read(studentOwner, classroomA), statusIs(503))
    process.stdout.write('PASS saved historical absence versus present null, 500 sorted materials and 501 fail-closed boundary\n')

    sql(`update public.classrooms set source_blueprint_id=null,source_blueprint_version_id=null where id=${quote(classroomA)};`)
    assert.deepEqual(await read(studentOwner, classroomA), { materials: null })
    process.stdout.write('PASS purge-shaped source detachment yields no linked materials\n')
  } finally {
    // Setup may have committed even when its command returned an ambiguous failure.
    // Match every deletion to random fixture IDs and synthetic email/title/code or audit provenance.
    sql(`begin;
      delete from public.effective_feature_entitlement_audit audit using (values ${entitlementValues}) fixture(operation,u)
        where audit.operation_id=fixture.operation and audit.subject_user_id=fixture.u
          and audit.actor_ref='test:blueprint-material-read' and audit.reason_code=${quote(tag)}
          and audit.feature_key='classrooms.create';
      delete from public.effective_feature_entitlement_audit audit using public.account_plan_audit plan,
        (values ${identities}) identity(id,email),public.users fixture
        where audit.operation_id=plan.operation_id and audit.subject_user_id=plan.subject_user_id
          and plan.subject_user_id=identity.id and fixture.id=identity.id and fixture.email=identity.email
          and plan.actor_ref='system:user-provisioning' and plan.reason_code='default_free_account_provisioning'
          and audit.actor_ref='system:user-provisioning' and audit.reason_code='default_free_account_provisioning'
          and audit.feature_key='classrooms.create';
      delete from public.account_plan_audit plan using (values ${identities}) identity(id,email),public.users fixture
        where plan.subject_user_id=identity.id and fixture.id=identity.id and fixture.email=identity.email
          and plan.actor_ref='system:user-provisioning' and plan.reason_code='default_free_account_provisioning';
      delete from public.classrooms classroom using (values
        ${classes.map(([id, label]) => `(${quote(id)}::uuid,${quote(`${tag} ${label}`)},${quote(`${tag}_${label === 'no_link' ? 'n' : label.toLowerCase()}`)})`).join(',')}
      ) fixture(id,title,class_code)
        where classroom.id=fixture.id and classroom.title=fixture.title and classroom.class_code=fixture.class_code;
      delete from public.users fixture using (values ${identities}) identity(id,email)
        where fixture.id=identity.id and fixture.email=identity.email;
      commit;`)
    assert.equal(sql(`select
      (select count(*) from public.users where id in (${ids(personIds)}))+
      (select count(*) from public.classrooms where id in (${ids(classIds)}))+
      (select count(*) from public.classroom_enrollments where classroom_id in (${ids(classIds)}) or student_id in (${ids(personIds)}))+
      (select count(*) from public.course_blueprints where id in (${ids(blueprintIds)}))+
      (select count(*) from public.course_blueprint_versions where course_blueprint_id in (${ids(blueprintIds)}) or id in (${ids(versionIds)}))+
      (select count(*) from public.course_blueprint_materials where course_blueprint_id in (${ids(blueprintIds)}) or id=${quote(draftMaterial)})+
      (select count(*) from public.course_blueprint_authoring_guidance_revisions where course_blueprint_id in (${ids(blueprintIds)}))+
      (select count(*) from public.classroom_archive_revisions where classroom_id in (${ids(classIds)}))+
      (select count(*) from public.account_plans where subject_user_id in (${ids(personIds)}))+
      (select count(*) from public.account_plan_audit where subject_user_id in (${ids(personIds)}))+
      (select count(*) from public.effective_feature_entitlements where subject_user_id in (${ids(personIds)}))+
      (select count(*) from public.effective_feature_entitlement_audit where subject_user_id in (${ids(personIds)})
        or operation_id in (select operation from (values ${entitlementValues}) fixture(operation,u)));`), '0')
    assert.deepEqual(globalCounts(), baseline, 'All global fixture table counts returned to their initial values')
    assert.equal(sql(`select count(*) from pg_stat_activity where application_name like ${quote(`${tag}%`)};`), '0')
    process.stdout.write('PASS exact synthetic linked Blueprint material fixture cleanup with zero residual rows and global baseline equality\n')
  }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
