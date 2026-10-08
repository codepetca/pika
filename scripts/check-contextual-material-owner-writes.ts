// Local-only actual SDK and transaction races for reviewed, installed migration 234.
// Random exact fixtures; never applies schema, resets data, activates cohorts, or calls hosted APIs.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { createClient } from '@supabase/supabase-js'
import { ApiError } from '../src/lib/api-error'
import {
  createContextualMaterial, updateContextualMaterial, deleteContextualMaterial,
} from '../src/lib/server/contextual-material-mutation'

const container = 'supabase_db_pika'
assert.equal(execFileSync('docker', ['inspect', container, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}'], { encoding: 'utf8' }).trim(), 'pika')
assert.match(execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }), /:54322\s*$/m)
const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
assert.equal(status.API_URL, 'http://127.0.0.1:54321')
assert.equal(typeof status.ANON_KEY, 'string')
assert.equal(typeof status.SERVICE_ROLE_KEY, 'string')
process.env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = status.ANON_KEY
process.env.SUPABASE_SECRET_KEY = status.SERVICE_ROLE_KEY
const client = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const tag = `matwrite_${randomUUID().slice(0, 8)}`
const owner = randomUUID(), teacher = randomUUID(), member = randomUUID(), outsider = randomUUID()
const classroom = randomUUID(), otherClassroom = randomUUID(), deletedClassroom = randomUUID()
const material = randomUUID(), foreign = randomUUID(), deletedMaterial = randomUUID()
const artifact = randomUUID(), sourceArtifact = randomUUID()
const blueprint = randomUUID(), blueprintVersion = randomUUID()
const doc = { type: 'doc', content: [{ type: 'paragraph', content: [
  { type: 'text', text: 'A 🦉 title', marks: [{ type: 'bold' }] },
  { type: 'image', attrs: { src: 'https://example.invalid/figure.png', alt: 'Figure' } },
] }] }
const emptyDoc = { type: 'doc', content: [] }
const q = (value: string) => `'${value.replaceAll("'", "''")}'`
const json = (value: unknown) => `${q(JSON.stringify(value))}::jsonb`
const ids = (values: string[]) => values.map(q).join(',')
const identities = [[owner, 'owner'], [teacher, 'teacher'], [member, 'member'], [outsider, 'outsider']] as const
const identityValues = identities.map(([id, label]) => `(${q(id)}::uuid,${q(`${tag}_${label}@example.invalid`)})`).join(',')
const classes = [[classroom, 'primary', owner, 'p'], [otherClassroom, 'other', teacher, 'o'],
  [deletedClassroom, 'deletion', owner, 'd']] as const
const entitlementPairs = [owner, teacher, member].map(subject => ({ subject, operation: randomUUID() }))
const entitlementValues = entitlementPairs.map(({ subject, operation }) => `(${q(operation)}::uuid,${q(subject)}::uuid)`).join(',')
const sessions: Session[] = []
function sql(statement: string) {
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt',
    '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], {
    input: `set statement_timeout='35s'; set lock_timeout='7s'; ${statement}`,
    encoding: 'utf8', timeout: 40_000, maxBuffer: 5_000_000,
  }).trim()
}
assert.equal(sql("select exists(select 1 from supabase_migrations.schema_migrations where version='234');"), 't',
  'Install only separately reviewed local migration 234 before this harness')
const signatures = [
  'create_classwork_material_for_owner_v2(uuid,uuid,text,jsonb,boolean)',
  'update_classwork_material_for_owner_v1(uuid,uuid,uuid,jsonb)',
  'delete_classwork_material_for_owner_v1(uuid,uuid,uuid)',
]
for (const signature of signatures) {
  assert.equal(sql(`select to_regprocedure(${q(`public.${signature}`)}) is not null;`), 't')
  for (const role of ['anon', 'authenticated']) {
    assert.equal(sql(`select has_function_privilege(${q(role)},${q(`public.${signature}`)},'execute');`), 'f')
  }
  assert.equal(sql(`select has_function_privilege('service_role',${q(`public.${signature}`)},'execute');`), 't')
}
function baseline() {
  return JSON.parse(sql(`select jsonb_build_object(
    'users',(select count(*) from public.users),
    'classrooms',(select count(*) from public.classrooms),
    'enrollments',(select count(*) from public.classroom_enrollments),
    'materials',(select count(*) from public.classwork_materials),
    'assignments',(select count(*) from public.assignments),
    'surveys',(select count(*) from public.surveys),
    'blueprints',(select count(*) from public.course_blueprints),
    'blueprint_versions',(select count(*) from public.course_blueprint_versions),
    'revisions',(select count(*) from public.classroom_archive_revisions),
    'plans',(select count(*) from public.account_plans),
    'plan_audit',(select count(*) from public.account_plan_audit),
    'entitlements',(select count(*) from public.effective_feature_entitlements),
    'entitlement_audit',(select count(*) from public.effective_feature_entitlement_audit));`))
}
const initialBaseline = baseline()
function create(actor = owner, target = classroom, title = 'Created', isDraft = true) {
  return `select public.create_classwork_material_for_owner_v2(${q(actor)},${q(target)},${q(title)},${json(doc)},${isDraft})::text;`
}
function patch(body: Record<string, unknown> = { title: 'Changed' }, actor = owner,
  target = classroom, id = material) {
  return `select public.update_classwork_material_for_owner_v1(${q(actor)},${q(target)},${q(id)},${json(body)})::text;`
}
function remove(actor = owner, target = classroom, id = material) {
  return `select public.delete_classwork_material_for_owner_v1(${q(actor)},${q(target)},${q(id)})::text;`
}
const service = (statement: string) => `set local role service_role; ${statement}`
function expectResult(raw: string, actor: string, target: string, id?: string) {
  const parsed = JSON.parse(raw)
  assert.equal(parsed.actor_id, actor)
  assert.equal(parsed.classroom_id, target)
  if (id) assert.equal(parsed.material.id, id)
  assert.equal(parsed.material.classroom_id, target)
  return parsed.material as Record<string, unknown>
}
function revisions(target = classroom) {
  return JSON.parse(sql(`select jsonb_build_object(
    'archive',(select revision from public.classroom_archive_revisions where classroom_id=${q(target)}),
    'blueprint',(select blueprint_source_revision from public.classrooms where id=${q(target)}));`)) as {
    archive: number; blueprint: number
  }
}
function row(id = material) {
  return JSON.parse(sql(`select to_jsonb(m) from public.classwork_materials m where id=${q(id)};`)) as Record<string, unknown> | null
}
function state(id = material, target = classroom) { return { row: row(id), revisions: revisions(target) } }
function classworkSnapshot() {
  const items = JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('type',item.kind,
    'id',item.id) order by item.position,item.kind,item.id),'[]'::jsonb)
    from (select 'assignment'::text kind,id,position from public.assignments where classroom_id=${q(classroom)}
      union all select 'material',id,position from public.classwork_materials where classroom_id=${q(classroom)}
      union all select 'survey',id,position from public.surveys where classroom_id=${q(classroom)}) item;`)) as
    { type: 'assignment' | 'material' | 'survey'; id: string }[]
  assert(items.some(item => item.type === 'material' && item.id === material))
  assert(items.every(item => ['assignment', 'material', 'survey'].includes(item.type)
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id)))
  assert.equal(new Set(items.map(item => `${item.type}:${item.id}`)).size, items.length)
  assert.equal(Number(sql(`select
    (select count(*) from public.assignments where classroom_id=${q(classroom)})+
    (select count(*) from public.classwork_materials where classroom_id=${q(classroom)})+
    (select count(*) from public.surveys where classroom_id=${q(classroom)});`)), items.length,
  'Reorder snapshot must bind every current item to this exact fixture classroom')
  return items
}
function reset() {
  sql(`begin;
    update public.classrooms set teacher_id=${q(owner)},archived_at=null
      where id=${q(classroom)} and title=${q(`${tag} primary`)};
    insert into public.classwork_materials(id,classroom_id,created_by,title,content,is_draft,released_at,
      position,artifact_id,source_artifact_id,blueprint_archived_at) values
      (${q(material)},${q(classroom)},${q(teacher)},'Original',${json(doc)},false,'2020-01-01T00:00:00Z',
        0,${q(artifact)},${q(sourceArtifact)},'2020-02-01T00:00:00Z')
      on conflict(id) do update set classroom_id=excluded.classroom_id,created_by=excluded.created_by,
        title=excluded.title,content=excluded.content,is_draft=excluded.is_draft,released_at=excluded.released_at,
        position=excluded.position,artifact_id=excluded.artifact_id,source_artifact_id=excluded.source_artifact_id,
        source_blueprint_version_id=null,blueprint_archived_at=excluded.blueprint_archived_at;
    commit;`)
}
class Session {
  name: string
  child: ReturnType<typeof spawn>
  done: Promise<void>
  output = ''
  errors = ''
  closed = false
  pending: { marker: string; timer: NodeJS.Timeout; resolve: (value: string) => void; reject: (error: Error) => void } | null = null
  constructor(label: string) {
    this.name = `${tag}_${label}`
    this.child = spawn('docker', ['exec', '-i', '-e', `PGAPPNAME=${this.name}`, container,
      'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'])
    this.child.stdout.on('data', chunk => {
      this.output += chunk.toString()
      if (this.pending && this.output.includes(this.pending.marker)) {
        const pending = this.pending; this.pending = null; clearTimeout(pending.timer)
        pending.resolve(this.output.slice(0, this.output.indexOf(pending.marker)).trim())
      }
    })
    this.child.stderr.on('data', chunk => { this.errors += chunk.toString() })
    this.child.stdin.on('error', error => this.fail(error))
    this.child.on('error', error => this.fail(error))
    this.done = new Promise(resolve => this.child.on('close', code => {
      this.closed = true; this.fail(new Error(`${this.name} exited ${code}: ${this.errors}`)); resolve()
    }))
    sessions.push(this)
  }
  fail(error: Error) { if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = null } }
  run(statement: string) {
    assert(!this.pending && !this.closed)
    this.output = ''; this.errors = ''; const marker = `done_${randomUUID()}`
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error(`Session timeout: ${this.name}`)), 30_000)
      this.pending = { marker, timer, resolve, reject }
      this.child.stdin.write(`set statement_timeout='25s'; set lock_timeout='10s'; ${statement}\n\\echo ${marker}\n`)
    })
  }
  async close() {
    if (!this.closed) this.child.stdin.end('ROLLBACK;\n\\q\n')
    const force = setTimeout(() => this.child.kill('SIGTERM'), 5000)
    const hard = setTimeout(() => this.child.kill('SIGKILL'), 8000)
    let bound: NodeJS.Timeout | undefined
    try { await Promise.race([this.done, new Promise<never>((_, reject) => { bound = setTimeout(() => reject(new Error('Session close timeout')), 10_000) })]) }
    finally { clearTimeout(force); clearTimeout(hard); clearTimeout(bound) }
  }
}
const observer = new Session('observer')
async function blocked(waiter: Session, holder: Session) {
  for (let i = 0; i < 100; i++) {
    if (await observer.run(`select exists(select 1 from pg_stat_activity w,pg_stat_activity h
      where w.application_name=${q(waiter.name)} and h.application_name=${q(holder.name)}
        and w.wait_event_type='Lock' and h.pid=any(pg_blocking_pids(w.pid)));`) === 't') return
    assert(waiter.pending, 'Contender completed before expected lock wait'); await delay(30)
  }
  throw new Error('Expected pg_blocking_pids evidence was not observed')
}
async function withSessions(label: string, body: (first: Session, second: Session) => Promise<void>) {
  const first = new Session(`${label}_first`), second = new Session(`${label}_second`)
  try { await body(first, second) } finally { await Promise.allSettled([first.close(), second.close()]) }
}
const apiStatus = (statusCode: number) => (error: unknown) => error instanceof ApiError && error.statusCode === statusCode
async function main() {
  try {
    sql(`begin;
      insert into public.users(id,email,role) values
        (${q(owner)},${q(`${tag}_owner@example.invalid`)},'student'),
        (${q(teacher)},${q(`${tag}_teacher@example.invalid`)},'teacher'),
        (${q(member)},${q(`${tag}_member@example.invalid`)},'teacher'),
        (${q(outsider)},${q(`${tag}_outsider@example.invalid`)},'student');
      set local role service_role;
      select public.set_effective_feature_entitlement_v1(operation,u,'classrooms.create','manual',true,
        clock_timestamp(),null,3,'test:234',${q(tag)},
        coalesce((select revision from public.effective_feature_entitlements where subject_user_id=u and feature_key='classrooms.create'),0))
        from (values ${entitlementValues}) fixture(operation,u);
      reset role;
      insert into public.classrooms(id,teacher_id,title,class_code) values
        ${classes.map(([id, label, teacherId, suffix]) => `(${q(id)},${q(teacherId)},${q(`${tag} ${label}`)},${q(`${tag}_${suffix}`)})`).join(',')};
      insert into public.classroom_enrollments(classroom_id,student_id) values(${q(classroom)},${q(member)});
      insert into public.classwork_materials(id,classroom_id,created_by,title,content,is_draft,released_at,
        position,artifact_id,source_artifact_id,blueprint_archived_at) values
        (${q(material)},${q(classroom)},${q(teacher)},'Original',${json(doc)},false,'2020-01-01T00:00:00Z',
          0,${q(artifact)},${q(sourceArtifact)},'2020-02-01T00:00:00Z'),
        (${q(foreign)},${q(otherClassroom)},${q(teacher)},'Foreign',${json(emptyDoc)},false,null,
          0,${q(randomUUID())},null,null),
        (${q(deletedMaterial)},${q(deletedClassroom)},${q(owner)},'Delete class',${json(emptyDoc)},true,null,
          0,${q(randomUUID())},null,null);
      commit;`)
    if (process.argv.includes('--verify-cleanup-after-fixture')) throw new Error('Forced post-fixture cleanup proof')

    const createdStudent = await createContextualMaterial({ actorId: owner, classroomId: classroom,
      body: { title: 'Student owner 🦉', content: doc, is_draft: true } })
    assert.equal(createdStudent.material.created_by, owner)
    assert.equal(createdStudent.material.classroom_id, classroom)
    assert.equal(createdStudent.material.source_artifact_id, null)
    assert.equal(createdStudent.material.source_blueprint_version_id, null)
    assert.equal(createdStudent.material.blueprint_archived_at, null)
    const createdTeacher = await createContextualMaterial({ actorId: teacher, classroomId: otherClassroom,
      body: { title: 'Teacher owner', content: emptyDoc, is_draft: false } })
    assert.equal(createdTeacher.material.created_by, teacher)
    assert.equal(createdTeacher.material.is_draft, false)
    assert(createdTeacher.material.released_at)
    const teacherEdit = await updateContextualMaterial({ actorId: teacher, classroomId: otherClassroom,
      materialId: createdTeacher.material.id, body: { title: 'Teacher edited' } })
    assert.equal(teacherEdit.material.title, 'Teacher edited')
    assert.equal(teacherEdit.material.released_at, createdTeacher.material.released_at)
    await assert.rejects(createContextualMaterial({ actorId: member, classroomId: classroom,
      body: { title: 'Denied', content: emptyDoc, is_draft: true } }), apiStatus(403))
    await assert.rejects(createContextualMaterial({ actorId: outsider, classroomId: classroom,
      body: { title: 'Denied', content: emptyDoc, is_draft: true } }), apiStatus(403))
    await assert.rejects(updateContextualMaterial({ actorId: member, classroomId: classroom,
      materialId: material, body: { title: 'Denied' } }), apiStatus(403))
    await assert.rejects(deleteContextualMaterial({ actorId: outsider, classroomId: classroom,
      materialId: material }), apiStatus(403))
    const rawForbidden = await client.rpc('delete_classwork_material_for_owner_v1', {
      p_actor_id: member, p_classroom_id: classroom, p_material_id: material,
    })
    assert.equal(rawForbidden.status, 403)
    assert.equal(rawForbidden.error?.code, '42501')
    const rawInvalid = await client.rpc('update_classwork_material_for_owner_v1', {
      p_actor_id: owner, p_classroom_id: classroom, p_material_id: material,
      p_patch: { position: 999 },
    })
    assert.equal(rawInvalid.status, 400)
    assert.equal(rawInvalid.error?.code, '22023')
    await assert.rejects(createContextualMaterial({ actorId: owner, classroomId: randomUUID(),
      body: { title: 'Missing', content: emptyDoc, is_draft: true } }), apiStatus(404))
    await assert.rejects(updateContextualMaterial({ actorId: owner, classroomId: classroom, materialId: foreign,
      body: { title: 'Cross class' } }), apiStatus(404))
    await assert.rejects(deleteContextualMaterial({ actorId: owner, classroomId: classroom, materialId: foreign }), apiStatus(404))
    const createdId = createdStudent.material.id
    const initialCreatedAt = createdStudent.material.created_at
    const stillDraft = await updateContextualMaterial({ actorId: owner, classroomId: classroom, materialId: createdId,
      body: { title: 'No publication key' } })
    assert.equal(stillDraft.material.is_draft, true)
    assert.equal(stillDraft.material.released_at, null)
    const published = await updateContextualMaterial({ actorId: owner, classroomId: classroom, materialId: createdId,
      body: { is_draft: false } })
    assert.equal(published.material.is_draft, false)
    assert(published.material.released_at)
    const repeat = await updateContextualMaterial({ actorId: owner, classroomId: classroom, materialId: createdId,
      body: { is_draft: false } })
    assert.equal(repeat.material.released_at, published.material.released_at)
    assert.equal(repeat.material.created_at, initialCreatedAt)
    const drafted = await updateContextualMaterial({ actorId: owner, classroomId: classroom, materialId: createdId,
      body: { is_draft: true } })
    assert.equal(drafted.material.released_at, null)
    const future = '2099-03-04T05:06:07.123456Z'
    sql(`update public.classwork_materials set is_draft=true,released_at=${q(future)} where id=${q(createdId)};`)
    const futureBefore = row(createdId)!.released_at
    const futureRetained = await updateContextualMaterial({ actorId: owner, classroomId: classroom, materialId: createdId,
      body: { is_draft: false } })
    assert.equal(futureRetained.material.released_at, futureBefore)
    assert.deepEqual(await deleteContextualMaterial({ actorId: owner, classroomId: classroom, materialId: createdId }), { success: true })
    assert.deepEqual(await deleteContextualMaterial({ actorId: teacher, classroomId: otherClassroom,
      materialId: createdTeacher.material.id }), { success: true })
    const prior = row()!
    const edit = await updateContextualMaterial({ actorId: owner, classroomId: classroom, materialId: material,
      body: { title: 'Changed historical author', content: doc } })
    for (const field of ['id','classroom_id','created_by','created_at','position','artifact_id','source_artifact_id',
      'source_blueprint_version_id','blueprint_archived_at'] as const) {
      assert.deepEqual(edit.material[field], prior[field])
    }
    reset()
    const beforeNoop = revisions()
    await updateContextualMaterial({ actorId: owner, classroomId: classroom, materialId: material, body: { title: 'Original' } })
    const afterNoop = revisions()
    assert.equal(afterNoop.archive, beforeNoop.archive + 1)
    assert.equal(afterNoop.blueprint, beforeNoop.blueprint)
    const beforePublication = revisions()
    await updateContextualMaterial({ actorId: owner, classroomId: classroom, materialId: material, body: { is_draft: true } })
    const afterPublication = revisions()
    assert.equal(afterPublication.archive, beforePublication.archive + 1)
    assert.equal(afterPublication.blueprint, beforePublication.blueprint)
    reset()
    sql(`update public.classrooms set archived_at=clock_timestamp() where id=${q(classroom)};`)
    await assert.rejects(createContextualMaterial({ actorId: owner, classroomId: classroom,
      body: { title: 'Archived', content: emptyDoc, is_draft: true } }), apiStatus(403))
    await assert.rejects(updateContextualMaterial({ actorId: owner, classroomId: classroom,
      materialId: material, body: { title: 'Archived' } }), apiStatus(403))
    await assert.rejects(deleteContextualMaterial({ actorId: owner, classroomId: classroom,
      materialId: material }), apiStatus(403))
    sql(`update public.classrooms set archived_at=null where id=${q(classroom)};`)
    process.stdout.write('PASS actual material owner SDK both global roles, publication presence, historical identity, ACL/status and revision split\n')

    // Parent/resource row-first acquisition uses NOWAIT and leaves material plus both revisions unchanged.
    for (const [label, lock] of [['parent', `select id from public.classrooms where id=${q(classroom)} for update;`],
      ['resource', `select id from public.classwork_materials where id=${q(material)} for update;`]]) {
      await withSessions(`${label}_lock`, async holder => {
        await holder.run(`begin; ${lock}`)
        const before = state()
        for (const statement of [patch(), remove(), ...(label === 'parent' ? [create()] : [])]) {
          assert.throws(() => sql(`begin; ${service(statement)} commit;`), /PT409/)
        }
        assert.deepEqual(state(), before)
      })
    }
    // Lifecycle first observes committed owner/archive; operation first holds the fence.
    for (const [label, update, restore] of [['transfer', `teacher_id=${q(teacher)}`, `teacher_id=${q(owner)}`],
      ['archive', 'archived_at=clock_timestamp()', 'archived_at=null']]) {
      for (const [operation, statement] of [['create', create()], ['patch', patch()], ['delete', remove()]]) {
        reset()
        await withSessions(`${label}_${operation}_first`, async (lifecycle, writer) => {
          const beforeRow = row()
          await lifecycle.run(`begin; update public.classrooms set ${update} where id=${q(classroom)};`)
          const pending = writer.run(`begin; ${service(statement)}`)
          const denied = assert.rejects(pending, /42501/)
          await blocked(writer, lifecycle); await lifecycle.run('commit;'); await denied
          assert.deepEqual(row(), beforeRow)
        })
        sql(`update public.classrooms set ${restore} where id=${q(classroom)};`)
        await withSessions(`${operation}_before_${label}`, async (writer, lifecycle) => {
          await writer.run(`begin; ${service(statement)}`)
          const pending = lifecycle.run(`begin; update public.classrooms set ${update} where id=${q(classroom)};`)
          await blocked(lifecycle, writer); await writer.run('commit;'); await pending; await lifecycle.run('commit;')
        })
        sql(`update public.classrooms set ${restore} where id=${q(classroom)};`)
      }
    }
    reset()
    // Legacy DML may own a resource row before its trigger obtains the classroom fence.
    await withSessions('legacy_row_first', async holder => {
      await holder.run(`begin; select id from public.classwork_materials where id=${q(material)} for update;`)
      const before = state()
      assert.throws(() => sql(`begin; ${service(patch())} commit;`), /PT409/)
      assert.throws(() => sql(`begin; ${service(remove())} commit;`), /PT409/)
      assert.deepEqual(state(), before)
    })
    for (const [label, statement, code] of [
      ['delete', `delete from public.classwork_materials where id=${q(material)};`, /PT404/],
      ['rebind', `update public.classwork_materials set classroom_id=${q(otherClassroom)} where id=${q(material)};`, /PT404/],
      ['content', `update public.classwork_materials set title='Legacy edit' where id=${q(material)};`, null],
    ] as const) {
      reset()
      await withSessions(`${label}_first`, async (legacy, writer) => {
        await legacy.run(`begin; ${statement}`)
        const pending = writer.run(`begin; ${service(patch({ title: 'After legacy' }))}`)
        const denied = code ? assert.rejects(pending, code) : null
        await blocked(writer, legacy); await legacy.run('commit;')
        if (denied) await denied
        else { expectResult(await pending, owner, classroom, material); await writer.run('commit;') }
      })
      reset()
    }
    // Two contextual RPCs serialize against the actual material row and current publication.
    for (const [label, statement] of [['patch', patch({ title: 'Second' })], ['delete', remove()]]) {
      reset()
      await withSessions(`patch_before_${label}`, async (first, next) => {
        await first.run(`begin; ${service(patch({ is_draft: true }))}`)
        const pending = next.run(`begin; ${service(statement)}`)
        await blocked(next, first); await first.run('commit;')
        const parsed = JSON.parse(await pending)
        if (label === 'patch') assert.equal(parsed.material.is_draft, true)
        else assert.equal(parsed.deleted, true)
        await next.run('commit;')
      })
    }
    // Whole-class deletion must win or wait atomically, even when material cascades.
    const installDeletedClass = () => sql(`begin;
      insert into public.classrooms(id,teacher_id,title,class_code)
        values(${q(deletedClassroom)},${q(owner)},${q(`${tag} deletion`)},${q(`${tag}_d`)})
        on conflict(id) do nothing;
      insert into public.classwork_materials(id,classroom_id,created_by,title,content,is_draft,
        position,artifact_id) values(${q(deletedMaterial)},${q(deletedClassroom)},${q(owner)},
          'Delete class',${json(emptyDoc)},true,0,${q(randomUUID())})
        on conflict(id) do nothing;
      commit;`)
    for (const [label, statement] of [
      ['create', create(owner, deletedClassroom)],
      ['patch', patch({ title: 'After class deletion' }, owner, deletedClassroom, deletedMaterial)],
      ['delete', remove(owner, deletedClassroom, deletedMaterial)],
    ]) {
      installDeletedClass()
      await withSessions(`class_delete_before_${label}`, async (deletion, writer) => {
        await deletion.run(`begin; delete from public.classrooms where id=${q(deletedClassroom)};`)
        const pending = writer.run(`begin; ${service(statement)}`)
        const denied = assert.rejects(pending, /P0002/)
        await blocked(writer, deletion); await deletion.run('commit;'); await denied
      })
      assert.equal(sql(`select count(*) from public.classwork_materials where classroom_id=${q(deletedClassroom)};`), '0')
      installDeletedClass()
      await withSessions(`${label}_before_class_delete`, async (writer, deletion) => {
        await writer.run(`begin; ${service(statement)}`)
        const pending = deletion.run(`begin; delete from public.classrooms where id=${q(deletedClassroom)};`)
        await blocked(deletion, writer); await writer.run('commit;'); await pending; await deletion.run('commit;')
      })
      assert.equal(sql(`select count(*) from public.classwork_materials where classroom_id=${q(deletedClassroom)};`), '0')
    }
    // Existing creator and reorder operations share the classroom-operation fence.
    const oldCreate = `select public.create_classwork_material_for_owner_v1(${q(owner)},${q(classroom)},
      'Mixed creator',${json(emptyDoc)},true)::text;`
    const mixedIds: string[] = []
    for (const oldFirst of [true, false]) {
      reset()
      await withSessions(`mixed_creator_${oldFirst}`, async (first, second) => {
        const firstPending = await first.run(`begin; ${service(oldFirst ? oldCreate : create())}`)
        const pending = second.run(`begin; ${service(oldFirst ? create() : oldCreate)}`)
        await blocked(second, first); await first.run('commit;')
        const firstResult = JSON.parse(firstPending)
        const secondResult = JSON.parse(await pending)
        assert.equal(secondResult.material.position, firstResult.material.position + 1)
        assert.equal(secondResult.material.created_by, owner)
        mixedIds.push(firstResult.material.id, secondResult.material.id)
        await second.run('commit;')
      })
    }
    sql(`delete from public.classwork_materials where classroom_id=${q(classroom)} and id in (${ids(mixedIds)});`)
    const survey = JSON.parse(sql(`begin; ${service(`select public.create_survey_for_owner_v1(
      ${q(owner)},${q(classroom)},${q(`${tag} survey`)},true,false)::text;`)} commit;`))
    assert.equal(survey.ok, true)
    assert.equal(survey.survey.classroom_id, classroom)
    const assignment = JSON.parse(sql(`begin; ${service(`select public.create_assignment_for_owner_v1(
      ${q(owner)},${q(classroom)},${q(`${tag} assignment`)},'','Instructions',${json(emptyDoc)},
      clock_timestamp()+interval '7 days','[]'::jsonb)::text;`)} commit;`))
    assert.equal(assignment.ok, true)
    assert.equal(assignment.assignment.classroom_id, classroom)
    const priorMax = Number(sql(`select coalesce(max(item.position),-1) from (
      select position from public.assignments where classroom_id=${q(classroom)}
      union all select position from public.classwork_materials where classroom_id=${q(classroom)}
      union all select position from public.surveys where classroom_id=${q(classroom)}) item;`))
    assert.equal(survey.survey.position + 1, assignment.assignment.position)
    const crossType = expectResult(sql(`begin; ${service(create(owner, classroom, 'After all three types'))} commit;`),
      owner, classroom)
    assert.equal(crossType.position, priorMax + 1)
    for (const reorderFirst of [true, false]) {
      reset()
      const items = classworkSnapshot()
      assert(items.some(item => item.type === 'assignment' && item.id === assignment.assignment.id))
      assert(items.some(item => item.type === 'survey' && item.id === survey.survey.id))
      assert(items.some(item => item.type === 'material' && item.id === crossType.id))
      const reorder = `select public.reorder_classwork_items_for_owner_v1(${q(owner)},${q(classroom)},
        ${json(items)})::text;`
      await withSessions(`reorder_${reorderFirst}`, async (first, second) => {
        await first.run(`begin; ${service(reorderFirst ? reorder : patch({ title: 'Before reorder' }))}`)
        const pending = second.run(`begin; ${service(reorderFirst ? patch({ title: 'After reorder' }) : reorder)}`)
        await blocked(second, first); await first.run('commit;')
        const result = JSON.parse(await pending)
        if (reorderFirst) assert.equal(result.material.title, 'After reorder')
        else assert.equal(result.ok, true)
        await second.run('commit;')
      })
    }
    // Linked lineage activates the existing nonblocking Blueprint-purge fence on DELETE.
    reset()
    sql(`begin;
      insert into public.course_blueprints(id,teacher_id,title)
        values(${q(blueprint)},${q(owner)},${q(`${tag} blueprint`)});
      insert into public.course_blueprint_versions(id,course_blueprint_id,version_number,
        source_draft_revision,snapshot_json,snapshot_sha256,created_by)
        select ${q(blueprintVersion)},id,1,content_revision,'{}'::jsonb,repeat('a',64),teacher_id
        from public.course_blueprints where id=${q(blueprint)};
      update public.classwork_materials set source_blueprint_version_id=${q(blueprintVersion)}
        where id=${q(material)} and classroom_id=${q(classroom)};
      commit;`)
    await withSessions('blueprint_purge_fence', async holder => {
      await holder.run(`begin; select pg_advisory_xact_lock(hashtextextended(
        jsonb_build_array('course_blueprint_purge',${q(blueprint)}::uuid)::text,0));`)
      const before = state()
      assert.throws(() => sql(`begin; ${service(remove())} commit;`), /PT409/)
      assert.deepEqual(state(), before)
      const edited = expectResult(sql(`begin; ${service(patch({ content: emptyDoc }))} commit;`), owner, classroom, material)
      assert.equal(edited.source_blueprint_version_id, blueprintVersion)
    })
    expectResult(sql(`begin; ${service(patch({ title: 'Linked after purge fence' }))} commit;`), owner, classroom, material)
    reset()
    process.stdout.write('PASS material owner lifecycle, resource, legacy row-first and contextual concurrency contracts\n')

    // Rollback-only fault after triggers: row, archive revision and Blueprint revision stay exact.
    reset()
    const beforeFault = state()
    sql(`begin;
      create function pg_temp.reject_fixture_material() returns trigger language plpgsql as $fault$
      begin if old.id=${q(material)}::uuid then raise exception using errcode='55000',message='Synthetic late failure'; end if; return new; end; $fault$;
      create trigger zz_${tag}_failure after update on public.classwork_materials
        for each row execute function pg_temp.reject_fixture_material();
      do $proof$ declare before_state jsonb; after_state jsonb; begin
        select jsonb_build_object('row',(select to_jsonb(m) from public.classwork_materials m where id=${q(material)}),
          'archive',(select revision from public.classroom_archive_revisions where classroom_id=${q(classroom)}),
          'blueprint',(select blueprint_source_revision from public.classrooms where id=${q(classroom)})) into before_state;
        begin perform public.update_classwork_material_for_owner_v1(${q(owner)},${q(classroom)},${q(material)},
          '{"title":"Late failure"}'::jsonb);
          raise exception 'Expected late failure'; exception when sqlstate 'PT409' then null; end;
        select jsonb_build_object('row',(select to_jsonb(m) from public.classwork_materials m where id=${q(material)}),
          'archive',(select revision from public.classroom_archive_revisions where classroom_id=${q(classroom)}),
          'blueprint',(select blueprint_source_revision from public.classrooms where id=${q(classroom)})) into after_state;
        if before_state is distinct from after_state then raise exception 'Late failure changed material/revisions'; end if;
      end; $proof$; rollback;`)
    assert.deepEqual(state(), beforeFault)
    process.stdout.write('PASS material owner late failure rolls back row and both revision counters\n')
  } finally {
    await Promise.allSettled(sessions.map(session => session.close()))
    sql(`begin;
      create temp table material_write_provision_ops(operation_id uuid,subject_user_id uuid,
        primary key(operation_id,subject_user_id)) on commit drop;
      insert into material_write_provision_ops select audit.operation_id,audit.subject_user_id
        from public.account_plan_audit audit join (values ${identityValues}) identity(id,email)
          on identity.id=audit.subject_user_id
        join public.users fixture on fixture.id=identity.id and fixture.email=identity.email
        where audit.actor_ref='system:user-provisioning' and audit.reason_code='default_free_account_provisioning';
      delete from public.effective_feature_entitlement_audit audit using (values ${entitlementValues}) fixture(operation,u)
        where audit.operation_id=fixture.operation and audit.subject_user_id=fixture.u
          and audit.actor_ref='test:234' and audit.reason_code=${q(tag)} and audit.feature_key='classrooms.create';
      delete from public.effective_feature_entitlement_audit audit using material_write_provision_ops operation
        where audit.operation_id=operation.operation_id and audit.subject_user_id=operation.subject_user_id
          and audit.actor_ref='system:user-provisioning' and audit.reason_code='default_free_account_provisioning'
          and audit.feature_key='classrooms.create';
      delete from public.account_plan_audit audit using material_write_provision_ops operation
        where audit.operation_id=operation.operation_id and audit.subject_user_id=operation.subject_user_id
          and audit.actor_ref='system:user-provisioning' and audit.reason_code='default_free_account_provisioning';
      delete from public.classrooms c using (values
        ${classes.map(([id, label, , suffix]) => `(${q(id)}::uuid,${q(`${tag} ${label}`)},${q(`${tag}_${suffix}`)})`).join(',')}
      ) fixture(id,title,class_code)
        where c.id=fixture.id and c.title=fixture.title and c.class_code=fixture.class_code;
      -- Blueprint deletion guard requires the existing owner-deletion cascade.
      delete from public.users u using (values ${identityValues}) identity(id,email)
        where u.id=identity.id and u.email=identity.email;
      commit;`)
    assert.equal(sql(`select
      (select count(*) from public.users where id in (${ids(identities.map(([id]) => id))}))+
      (select count(*) from public.classrooms where id in (${ids(classes.map(([id]) => id))}))+
      (select count(*) from public.classroom_enrollments where classroom_id in (${ids(classes.map(([id]) => id))})
        or student_id in (${ids(identities.map(([id]) => id))}))+
      (select count(*) from public.classwork_materials where classroom_id in (${ids(classes.map(([id]) => id))})
        or id in (${ids([material,foreign,deletedMaterial])}))+
      (select count(*) from public.assignments where classroom_id in (${ids(classes.map(([id]) => id))}))+
      (select count(*) from public.surveys where classroom_id in (${ids(classes.map(([id]) => id))}))+
      (select count(*) from public.course_blueprints where id=${q(blueprint)})+
      (select count(*) from public.course_blueprint_versions where id=${q(blueprintVersion)})+
      (select count(*) from public.classroom_archive_revisions where classroom_id in (${ids(classes.map(([id]) => id))}))+
      (select count(*) from public.account_plans where subject_user_id in (${ids(identities.map(([id]) => id))}))+
      (select count(*) from public.account_plan_audit where subject_user_id in (${ids(identities.map(([id]) => id))}))+
      (select count(*) from public.effective_feature_entitlements where subject_user_id in (${ids(identities.map(([id]) => id))}))+
      (select count(*) from public.effective_feature_entitlement_audit where subject_user_id in (${ids(identities.map(([id]) => id))})
        or operation_id in (select operation from (values ${entitlementValues}) fixture(operation,u)));`), '0')
    assert.deepEqual(baseline(), initialBaseline)
    assert.equal(sql(`select count(*) from pg_stat_activity where application_name like ${q(`${tag}%`)};`), '0')
    process.stdout.write('PASS exact synthetic material owner-write fixture cleanup with zero residual rows\n')
  }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
