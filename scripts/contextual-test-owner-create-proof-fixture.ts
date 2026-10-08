/** Inert finite source preparation, not native evidence or execution authority.
 * All trigger deltas/catalog assumptions below require root's installed proof.
 * No generated identity authorizes SQL cleanup; dispose only the exact project. */
import assert from 'node:assert/strict'
import { z } from 'zod'
import type { AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import { testOwnerDigest, testOwnerGuardSql } from './contextual-test-owner-detail-proof-fixture'
import { contextualTestCreateResultSchema, contextualTestCreateRequestSchema } from '../src/lib/validations/contextual-test-create'
import { boundedAssignmentListJson } from '../src/lib/validations/contextual-assignment-list-read'
import { contextualTestListTestSchema } from '../src/lib/validations/contextual-test-list-read'

export const TEST_OWNER_CREATE_CAPS = Object.freeze({ sqlBytes: 524288, networkRequests: 24, rpcRequests: 24, storageRequests: 0,
  requestMs: 20000, requestBytes: 16384, resultBytes: 16384, operationBytes: 65536, snapshotBytes: 8388608,
  snapshotRows: 100000, rowsPerTable: 10000, fingerprintTables: 1024, witnessIds: 24 })
export const TEST_OWNER_CREATE_SNAPSHOT_TABLES = Object.freeze(['public.users', 'public.classrooms', 'public.tests',
  'public.gradebook_categories', 'public.test_questions', 'public.assessment_drafts', 'public.test_attempts', 'public.test_responses',
  'public.test_student_availability', 'public.classroom_enrollments', 'public.classroom_roster', 'public.classroom_archive_revisions',
  'public.managed_storage_objects', 'public.managed_storage_json_references', 'public.test_document_snapshot_storage_cleanup',
  'public.pal_event_outbox', 'private.pal_membership_outbox', 'private.pal_membership_generations', 'private.pal_membership_settings',
  'private.pal_classroom_signal_settings', 'private.student_provider_cleanup_settings', 'private.classroom_creation_entitlement_settings'])
const q = (value: string) => `'${value.replaceAll("'", "''")}'`
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
export function newTestOwnerCreateFixture(original: AssignmentListProofFixture) {
  assert.match(original.manifest.syntheticTag, /^assignmentlist_[a-f0-9]{12}$/)
  assert(Number.isFinite(Date.parse(original.manifest.now)))
  assert(original.allocatedIds.length <= 20000)
  const tag = `testownercreate_${original.manifest.syntheticTag.slice(-12)}`
  const id = (label: string) => { const h = testOwnerDigest(`${tag}:${label}`); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}` }
  const actors = (['student', 'teacher', 'student', 'teacher'] as const).map((role, i) => ({ id: id(`actor${i}`), role, email: `${tag}_${i}@example.invalid` }))
  const classLabels = ['student-owner-normal', 'teacher-owner-normal', 'archived-owner', 'student-owner-complete1001'] as const
  const classes = [0, 1, 2, 3].map(i => ({ id: id(`class${i}`), label: classLabels[i], owner: actors[i === 1 ? 1 : 0].id,
    title: `${tag} class ${i}`, code: `${tag}_${i}`, archived: i === 2 }))
  const tests = Array.from({ length: 1001 }, (_, i) => ({ id: id(`test${i}`), artifact_id: id(`artifact${i}`),
    classroom_id: classes[3].id, created_by: actors[0].id, title: `${tag} bulk ${i}`, position: i,
    blueprint_archived_at: i === 1000 ? original.manifest.now : null }))
  const enrollments = [[0, 0], [0, 2], [0, 3], [1, 1]].map(([ci, ai], i) => ({ id: id(`enrollment${i}`), classroom_id: classes[ci].id, student_id: actors[ai].id }))
  const missingClassroomId = id('reserved-missing-classroom')
  const caseFor = (label: string, ai: number, ci: number, expectedHTTP: 201 | 403 | 404, title?: string | null) => ({ label,
    actorId: actors[ai].id, classroomId: ci === -1 ? missingClassroomId : classes[ci].id,
    input: { classroom_id: ci === -1 ? missingClassroomId : classes[ci].id, ...(title === undefined ? {} : { title }) }, expectedHTTP,
    assertions: expectedHTTP === 201 ? ['Current active owner is authority', 'Exactly one Test and empty v1 draft', 'Source-derived +2 blueprint/+4 archive; native-unverified']
      : ['No Test or draft or other row changes', ...(label === 'former-owner-style-denied' ? ['No synthetic ownership transfer claimed'] : [])] })
  const cases = [caseFor('student-owner-custom', 0, 0, 201, 'Synthetic student owner'), caseFor('teacher-owner-custom', 1, 1, 201, 'Synthetic teacher owner'),
    caseFor('omitted-title', 0, 0, 201), caseFor('null-title', 0, 0, 201, null), caseFor('blank-title', 0, 0, 201, ' \t\uFEFF\u00A0\n'),
    caseFor('owner-self-enrollment', 0, 0, 201, 'Synthetic self-enrolled owner'), caseFor('bulk-1001-source', 0, 3, 201, 'Synthetic complete source'),
    caseFor('student-member-denied', 2, 0, 403, 'Denied'), caseFor('teacher-member-denied', 3, 0, 403, 'Denied'),
    caseFor('unrelated-owner-denied', 1, 0, 403, 'Denied'), caseFor('former-owner-style-denied', 2, 1, 403, 'Denied'),
    caseFor('archived-owner-denied', 0, 2, 403, 'Denied'), caseFor('missing-classroom', 0, -1, 404, 'Denied'),
    caseFor('restored-privilege-success', 0, 0, 201, 'Synthetic restored grant')]
  const privilegeProbe = { ...caseFor('raw-privilege-probe', 0, 0, 403, 'Synthetic grant probe'), expectedHTTP: 503 as const, expectedCode: '42501' as const }
  const allocatedIds = [...actors.map(a => a.id), ...classes.map(c => c.id), ...tests.flatMap(t => [t.id, t.artifact_id]), ...enrollments.map(e => e.id), missingClassroomId]
  const originalIds = new Set<string>(original.allocatedIds)
  assert.equal(new Set(allocatedIds).size, allocatedIds.length)
  assert(allocatedIds.every(value => !originalIds.has(value)))
  return freeze({ version: 1 as const, tag, now: original.manifest.now, actors, classes, tests, enrollments, missingClassroomId, cases, privilegeProbe, allocatedIds,
    forbiddenWitnessIds: [...original.allocatedIds, ...allocatedIds], inventory: { actors: 4, classes: 4, tests: 1001, questions: 0, drafts: 0, enrollments: 4,
      triggerCategories: 12, archiveRevisionRows: 4, cases: 14, successes: 8 }, nativeVerified: false as const,
    caveats: ['Natural categories/revision counters observed later, never overwritten', 'Legacy stale MAX caller may insert duplicate position after contextual commit',
      'Sequence consumption is nontransactional, not a row-equality claim', 'Lost acknowledgement requires failure/disposal, never discovery or automatic retry'] })
}
export type TestOwnerCreateFixture = ReturnType<typeof newTestOwnerCreateFixture>
function boundedSql(sql: string) { assert(Buffer.byteLength(sql) <= TEST_OWNER_CREATE_CAPS.sqlBytes); return sql }
export function testOwnerCreateSetupSql(f: TestOwnerCreateFixture, projectId: string) {
  assert.equal(projectId, `pika_assignment_list_${f.tag.slice(-12)}`)
  const classes = f.classes.map(c => q(c.id)).join(',')
  return boundedSql(`${testOwnerGuardSql(projectId)}
begin;set local lock_timeout='3s';set local statement_timeout='30s';
do $collision$ declare owned uuid[]:=array[${f.allocatedIds.map(q).join(',')}]::uuid[];begin
 if ${['users', 'classrooms', 'tests', 'test_questions', 'assessment_drafts', 'classroom_enrollments', 'test_attempts', 'test_responses', 'test_student_availability', 'managed_storage_objects'].map(t => `exists(select 1 from public.${t} where id=any(owned))`).join('\n or ')}
 or exists(select 1 from public.users where email like ${q(f.tag + '%')})
 or exists(select 1 from public.classrooms where class_code like ${q(f.tag + '%')})
 or exists(select 1 from public.tests where classroom_id=any(owned) or artifact_id=any(owned) or source_artifact_id=any(owned))
 or exists(select 1 from public.test_questions where test_id=any(owned) or artifact_id=any(owned) or source_artifact_id=any(owned))
 or exists(select 1 from public.assessment_drafts where classroom_id=any(owned) or assessment_id=any(owned))
 or exists(select 1 from public.gradebook_categories where classroom_id=any(owned))
 or exists(select 1 from public.classroom_enrollments where classroom_id=any(owned) or student_id=any(owned))
 or exists(select 1 from public.managed_storage_objects where classroom_id=any(owned) or resource_id=any(owned))
 or exists(select 1 from public.managed_storage_json_references where test_id=any(owned) or managed_object_id=any(owned))
 or exists(select 1 from private.pal_membership_generations where generation_id=any(owned))
 then raise exception 'Test create namespace collision';end if;end;$collision$;
insert into public.users(id,email,role) values ${f.actors.map(a => `(${q(a.id)},${q(a.email)},${q(a.role)})`).join(',')};
insert into public.classrooms(id,teacher_id,title,class_code,feature_visibility) values ${f.classes.map(c => `(${q(c.id)},${q(c.owner)},${q(c.title)},${q(c.code)},'{"classwork":false}'::jsonb)`).join(',')};
insert into public.classroom_enrollments(id,classroom_id,student_id) values ${f.enrollments.map(e => `(${q(e.id)},${q(e.classroom_id)},${q(e.student_id)})`).join(',')};
insert into public.tests(id,artifact_id,classroom_id,created_by,title,position,blueprint_archived_at) values ${f.tests.map(t => `(${q(t.id)},${q(t.artifact_id)},${q(t.classroom_id)},${q(t.created_by)},${q(t.title)},${t.position},${t.blueprint_archived_at ? q(t.blueprint_archived_at) : 'null'})`).join(',')};
do $archive$ declare affected integer;begin
 update public.classrooms set archived_at=${q(f.now)} where id=${q(f.classes[2].id)} and teacher_id=${q(f.classes[2].owner)} and archived_at is null;
 get diagnostics affected=row_count;if affected<>1 then raise exception 'Test create archive differs';end if;end;$archive$;
-- Natural category and revision rows are captured by the next full snapshot.
-- This checks cardinality only; it does not overwrite or invent their counters.
do $inventory$ begin
 if (select count(*) from public.tests where classroom_id in (${classes}))<>1001
 or (select count(*) from public.gradebook_categories where classroom_id in (${classes}))<>12
 or (select count(*) from public.classroom_archive_revisions where classroom_id in (${classes}))<>4
 or (select count(*) from public.classroom_enrollments where classroom_id in (${classes}))<>4
 or exists(select 1 from public.test_questions where test_id in (select id from public.tests where classroom_id in (${classes})))
 or exists(select 1 from public.assessment_drafts where classroom_id in (${classes}))
 or exists(select 1 from public.classrooms where id=${q(f.missingClassroomId)})
 then raise exception 'Test create inventory differs';end if;end;$inventory$;commit;`)
}
export function testOwnerCreateSnapshotSql(f: TestOwnerCreateFixture) {
  const classes = f.classes.map(c => q(c.id)).join(','); const actors = f.actors.map(a => q(a.id)).join(',')
  const tests = `select id from public.tests where classroom_id in (${classes})`
  const scopes: Array<[string, string]> = [['public.users', `id in (${actors})`], ['public.classrooms', `id in (${classes})`],
    ['public.tests', `classroom_id in (${classes})`], ['public.gradebook_categories', `classroom_id in (${classes})`],
    ['public.test_questions', `test_id in (${tests})`], ['public.assessment_drafts', `classroom_id in (${classes}) or assessment_id in (${tests})`],
    ...['test_attempts', 'test_responses', 'test_student_availability'].map(t => [`public.${t}`, `test_id in (${tests})`] as [string,string]),
    ['public.classroom_enrollments', `classroom_id in (${classes})`], ['public.classroom_roster', `classroom_id in (${classes})`],
    ['public.classroom_archive_revisions', `classroom_id in (${classes})`], ['public.managed_storage_objects', `classroom_id in (${classes}) or resource_id in (${tests})`],
    ['public.managed_storage_json_references', `test_id in (${tests})`], ['public.test_document_snapshot_storage_cleanup', 'true'],
    ['public.pal_event_outbox', `student_id in (${actors})`], ['private.pal_membership_outbox', `classroom_id in (${classes}) or student_id in (${actors})`],
    ['private.pal_membership_generations', `generation_id in (${f.enrollments.map(e => q(e.id)).join(',')}) or scope_digest in (${f.classes.flatMap(c => f.actors.map(a => `private.pal_membership_scope(${q(c.id)}::uuid,${q(a.id)}::uuid)`)).join(',')})`],
    ...['pal_membership_settings', 'pal_classroom_signal_settings', 'student_provider_cleanup_settings', 'classroom_creation_entitlement_settings'].map(t => [`private.${t}`, 'true'] as [string,string])]
  assert.deepEqual(scopes.map(([table]) => table), TEST_OWNER_CREATE_SNAPSHOT_TABLES)
  const nonTarget = `(select coalesce(jsonb_agg(jsonb_build_object('table',n.nspname||'.'||c.relname,'fingerprint',
 query_to_xml(format('select count(*) as count,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'''' order by md5(to_jsonb(r)::text)),'''')) as digest from %I.%I r %s',n.nspname,c.relname,
 case when n.nspname='public' and c.relname='classrooms' then ${q(`where r.id not in (${classes})`)}
 when n.nspname='public' and c.relname='classroom_archive_revisions' then ${q(`where r.classroom_id not in (${classes})`)}
 when n.nspname='public' and c.relname='tests' then ${q(`where r.classroom_id not in (${classes})`)}
 when n.nspname='public' and c.relname='assessment_drafts' then ${q(`where not (r.classroom_id in (${classes}) or r.assessment_id in (${tests}))`)}
 else '' end),true,false,'')::text) order by n.nspname,c.relname),'[]'::jsonb)
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname in ('public','private','storage'))`
  return boundedSql(`begin isolation level repeatable read read only;set local lock_timeout='3s';set local statement_timeout='30s';
select jsonb_build_object(${scopes.map(([table, predicate]) => `${q(table)},(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from ${table} t where ${predicate})`).join(',')},'__nontarget_fingerprints',${nonTarget});rollback;`)
}

type Envelope = z.infer<typeof contextualTestCreateResultSchema>
export type TestOwnerCreateWitness = { caseLabel: string; title: string; ids: string[]; envelope: Envelope; state: 'provisional' | 'verified' }
function validateWitness(f: TestOwnerCreateFixture, caseLabel: string, value: unknown, title: string): TestOwnerCreateWitness {
  const c = f.cases.find(c => c.label === caseLabel); assert(c && c.expectedHTTP === 201, 'Unknown/denied create witness')
  assert(boundedAssignmentListJson(value, TEST_OWNER_CREATE_CAPS.resultBytes), 'Oversize witness')
  const e = contextualTestCreateResultSchema.parse(value)
  contextualTestCreateRequestSchema.parse({ classroom_id: c.classroomId, title })
  assert(title === title.trim() && title.length > 0)
  if (c.input.title?.trim()) assert.equal(title, c.input.title.trim())
  else assert.match(title, /^Untitled \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/) // Actual RPC p_title, never fixture.now.
  assert.equal(e.actor_id, c.actorId); assert.equal(e.classroom_id, c.classroomId); assert.equal(e.test_id, e.test.id)
  assert.equal(e.test.created_by, c.actorId); assert.equal(e.test.classroom_id, c.classroomId); assert.equal(e.test.title, title)
  assert.equal(e.draft.assessment_id, e.test.id); assert.equal(e.draft.classroom_id, c.classroomId)
  assert.equal(e.draft.created_by, c.actorId); assert.equal(e.draft.updated_by, c.actorId); assert.equal(e.draft.content.title, title)
  const stamp = e.test.created_at
  assert([e.test.updated_at, e.draft.created_at, e.draft.updated_at].every(s => s === stamp))
  if (e.test.gradebook_category_id === null) assert.equal(e.test.gradebook_weight, 10)
  const ids = [e.test.id, e.test.artifact_id, e.draft.id]
  assert.equal(new Set(ids).size, 3); assert(ids.every(id => !f.forbiddenWitnessIds.includes(id)))
  return { caseLabel, title, ids, envelope: e, state: 'provisional' }
}
function validateLedger(f: TestOwnerCreateFixture, ledger: TestOwnerCreateWitness[]) {
  assert(Array.isArray(ledger) && ledger.length <= f.inventory.successes)
  assert(boundedAssignmentListJson(ledger, f.inventory.successes * TEST_OWNER_CREATE_CAPS.resultBytes), 'Oversize/non-JSON ledger')
  const entries = ledger.map(w => {
    assert(w.state === 'provisional' || w.state === 'verified')
    const valid = validateWitness(f, w.caseLabel, w.envelope, w.title); assert.deepEqual(w.ids, valid.ids)
    return { ...valid, state: w.state }
  })
  assert.equal(new Set(entries.map(w => w.caseLabel)).size, entries.length)
  const ids = entries.flatMap(w => w.ids); assert(ids.length <= TEST_OWNER_CREATE_CAPS.witnessIds); assert.equal(new Set(ids).size, ids.length)
  return entries
}
export function registerTestOwnerCreateWitness(f: TestOwnerCreateFixture, ledger: TestOwnerCreateWitness[], caseLabel: string, value: unknown, actualRpcTitle: string) {
  assert(validateLedger(f, ledger).every(w => w.state === 'verified'), 'Prior witness effects not verified')
  return freeze(validateLedger(f, [...validateLedger(f, ledger), validateWitness(f, caseLabel, value, actualRpcTitle)]))
}
type Row = Record<string, unknown>
type Snapshot = Record<string, Row[]>
function snapshot(value: unknown): Snapshot {
  assert(boundedAssignmentListJson(value, TEST_OWNER_CREATE_CAPS.snapshotBytes), 'Oversize/non-JSON snapshot')
  const s = z.record(z.string(), z.array(z.record(z.string(), z.unknown())).max(TEST_OWNER_CREATE_CAPS.rowsPerTable)).parse(value)
  assert.deepEqual(Object.keys(s).sort(), [...TEST_OWNER_CREATE_SNAPSHOT_TABLES, '__nontarget_fingerprints'].sort())
  assert(Object.values(s).reduce((n, rows) => n + rows.length, 0) <= TEST_OWNER_CREATE_CAPS.snapshotRows)
  const fingerprints = z.array(z.object({ table: z.string().regex(/^(public|private|storage)\.[a-z_0-9]+$/), fingerprint: z.string().min(1).max(4096) }).strict())
    .min(1).max(TEST_OWNER_CREATE_CAPS.fingerprintTables).parse(s.__nontarget_fingerprints)
  assert.equal(new Set(fingerprints.map(r => r.table)).size, fingerprints.length)
  for (const table of ['public.users', 'public.tests', 'public.assessment_drafts', 'public.classrooms', 'public.classroom_archive_revisions',
    'private.pal_membership_settings', 'storage.objects', 'storage.buckets']) assert(fingerprints.some(r => r.table === table), 'Incomplete fingerprint')
  return s
}
function indexed(rows: Row[], key: string) {
  const uuid = z.string().uuid().refine(s => s === s.toLowerCase())
  const pairs = rows.map(row => [uuid.parse(row[key]), row] as const)
  assert.equal(new Set(pairs.map(([id]) => id)).size, pairs.length, 'Duplicate snapshot identity')
  return new Map(pairs)
}
function sameRows(a: Row[], b: Row[]) {
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
    if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
    return JSON.stringify(value)
  }
  assert.deepEqual(a.map(canonical).sort(), b.map(canonical).sort())
}
function baseline(f: TestOwnerCreateFixture, before: Snapshot, prior: TestOwnerCreateWitness[]) {
  const tests = indexed(before['public.tests'], 'id'); const drafts = indexed(before['public.assessment_drafts'], 'id')
  assert.equal(tests.size, f.tests.length + prior.length, 'Incomplete/unwitnessed baseline Tests')
  assert.equal(drafts.size, prior.length, 'Incomplete/unwitnessed baseline drafts')
  for (const planned of f.tests) {
    const row = contextualTestListTestSchema.parse(tests.get(planned.id))
    for (const [key,value] of Object.entries(planned)) {
      if (key === 'blueprint_archived_at' && value !== null) assert.equal(Date.parse(String(row.blueprint_archived_at)), Date.parse(String(value)))
      else assert.deepEqual(row[key as keyof typeof row], value)
    }
  }
  for (const w of prior) {
    assert.deepEqual(tests.get(w.envelope.test.id), w.envelope.test)
    assert.deepEqual(drafts.get(w.envelope.draft.id), w.envelope.draft)
  }
  const artifacts = [...tests.values()].map(row => z.string().uuid().parse(row.artifact_id))
  assert.equal(new Set(artifacts).size, artifacts.length)
  const actors = indexed(before['public.users'], 'id'); assert.equal(actors.size, f.actors.length)
  for (const actor of f.actors) for (const [key,value] of Object.entries(actor)) assert.equal(actors.get(actor.id)?.[key], value)
  const enrollments = indexed(before['public.classroom_enrollments'], 'id'); assert.equal(enrollments.size, f.enrollments.length)
  for (const enrollment of f.enrollments) for (const [key,value] of Object.entries(enrollment)) assert.equal(enrollments.get(enrollment.id)?.[key], value)
  const categorySchema = z.object({ id: z.string().uuid(), classroom_id: z.string().uuid(), is_default: z.boolean(),
    position: z.number().int().min(0).max(2147483647), default_assessment_weight: z.number().int().min(0).max(999) }).passthrough()
  const categories = before['public.gradebook_categories'].map(row => categorySchema.parse(row))
  assert.equal(indexed(categories, 'id').size, f.inventory.triggerCategories)
  for (const classroom of f.classes) {
    const rows = categories.filter(row => row.classroom_id === classroom.id); assert.equal(rows.length, 3)
    assert(rows.filter(row => row.is_default).length <= 1)
  }
  const classes = indexed(before['public.classrooms'], 'id'); const archives = indexed(before['public.classroom_archive_revisions'], 'classroom_id')
  assert.equal(classes.size, f.classes.length); assert.equal(archives.size, f.classes.length)
  for (const classroom of f.classes) {
    const row = classes.get(classroom.id); assert(row && archives.has(classroom.id))
    assert.equal(row.teacher_id, classroom.owner); assert.equal(row.title, classroom.title)
    assert(classroom.archived ? Number.isFinite(Date.parse(String(row.archived_at))) : row.archived_at === null)
  }
  for (const table of ['public.test_questions','public.test_attempts','public.test_responses','public.test_student_availability',
    'public.managed_storage_objects','public.managed_storage_json_references']) assert.equal(before[table].length, 0)
}
/** The expected table catalogue is externally sealed from the original
 * canonical read-only receipt before project preparation. Never derive this
 * set from the ephemeral fingerprint list it is intended to verify. The source-
 * hash-bound253 addition is required alongside every canonical table; neither
 * omitted inherited tables nor unexpected additions are permitted. */
export function validateTestOwnerCreateSetupSnapshot(f: TestOwnerCreateFixture, value: unknown, expectedTables: readonly string[]) {
  const rows = snapshot(value)
  assert(Array.isArray(expectedTables) && expectedTables.length > 0 && expectedTables.length <= TEST_OWNER_CREATE_CAPS.fingerprintTables)
  assert(expectedTables.every(t => /^(public|private|storage)\.[a-z_0-9]+$/.test(t)))
  assert.equal(new Set(expectedTables).size, expectedTables.length)
  assert.deepEqual(rows.__nontarget_fingerprints.map(r => r.table).sort(), [...expectedTables].sort(), 'Complete table catalog differs')
  baseline(f, rows, [])
  return rows
}
export function verifyTestOwnerCreateEffects(f: TestOwnerCreateFixture, beforeValue: unknown, afterValue: unknown, caseLabel: string,
  ledger: TestOwnerCreateWitness[], publicResult?: unknown) {
  const before = snapshot(beforeValue); const after = snapshot(afterValue); const entries = validateLedger(f, ledger)
  const c = [...f.cases, f.privilegeProbe].find(c => c.label === caseLabel); assert(c, 'Unknown case')
  const witness = entries.find(w => w.caseLabel === caseLabel)
  if (c.expectedHTTP === 201) assert(witness?.state === 'provisional' && entries.at(-1)?.caseLabel === caseLabel, 'Missing/reused/out-of-order bound witness')
  assert(entries.filter(w => w.caseLabel !== caseLabel).every(w => w.state === 'verified'), 'Unverified prior witness')
  baseline(f, before, entries.filter(w => w.caseLabel !== caseLabel))
  if (c.expectedHTTP !== 201) {
    assert.equal(publicResult, undefined); assert(!entries.some(w => w.caseLabel === caseLabel))
    for (const table of Object.keys(before)) sameRows(before[table], after[table])
    return freeze(entries)
  }
  assert(witness, 'Missing bound witness')
  const { test, draft } = witness.envelope
  assert(boundedAssignmentListJson(publicResult, TEST_OWNER_CREATE_CAPS.resultBytes), 'Oversize/non-JSON public result')
  assert.deepEqual(publicResult, { test: { ...test, assessment_type: 'test' } })
  const bTests = indexed(before['public.tests'], 'id'); const aTests = indexed(after['public.tests'], 'id')
  const bDrafts = indexed(before['public.assessment_drafts'], 'id'); const aDrafts = indexed(after['public.assessment_drafts'], 'id')
  assert(!bTests.has(test.id) && !bDrafts.has(draft.id), 'Witness already existed')
  assert.equal(aTests.size, bTests.size + 1); assert.equal(aDrafts.size, bDrafts.size + 1)
  assert.deepEqual(aTests.get(test.id), test); assert.deepEqual(aDrafts.get(draft.id), draft)
  for (const [id,row] of bTests) assert.deepEqual(aTests.get(id), row)
  for (const [id,row] of bDrafts) assert.deepEqual(aDrafts.get(id), row)
  const prior = [...bTests.values()].filter(row => row.classroom_id === c.classroomId)
  const positions = prior.map(row => { assert(Number.isInteger(row.position) && Number.isSafeInteger(row.position)); return Number(row.position) })
  // Includes retired Tests; preserves negative legacy MAX semantics. No claim
  // that later legacy stale-MAX inserts are serialized with contextual create.
  assert.equal(test.position, (positions.length ? Math.max(...positions) : -1) + 1)
  const categories = before['public.gradebook_categories'].filter(row => row.classroom_id === c.classroomId).sort((a,b) =>
    Number(b.is_default) - Number(a.is_default) || Number(a.position) - Number(b.position) || String(a.id).localeCompare(String(b.id)))
  const category = categories[0]
  assert.equal(test.gradebook_category_id, category?.id ?? null)
  assert.equal(test.gradebook_weight, category?.default_assessment_weight ?? 10)
  for (const [table,key,revision,delta] of [['public.classrooms','id','blueprint_source_revision',2], ['public.classroom_archive_revisions','classroom_id','revision',4]] as const) {
    const oldRows = indexed(before[table], key); const newRows = indexed(after[table], key)
    assert.equal(oldRows.size, f.classes.length); assert.equal(newRows.size, oldRows.size)
    assert(f.classes.every(c => oldRows.has(c.id)))
    for (const [id,row] of oldRows) {
      if (id !== c.classroomId) assert.deepEqual(newRows.get(id), row)
      else {
        assert(Number.isSafeInteger(row[revision]) && Number(row[revision]) <= Number.MAX_SAFE_INTEGER - delta)
        if (table === 'public.classrooms') { assert.equal(row.teacher_id, c.actorId); assert.equal(row.archived_at, null) }
        assert.deepEqual(newRows.get(id), { ...row, [revision]: Number(row[revision]) + delta, updated_at: test.created_at })
      }
    }
  }
  for (const table of Object.keys(before)) if (!['public.tests','public.assessment_drafts','public.classrooms','public.classroom_archive_revisions'].includes(table)) sameRows(before[table], after[table])
  // Provisional registration is not acceptance. Only this returned ledger may
  // feed a subsequent registration; any exception fails the entire native run.
  return freeze(entries.map(w => ({ ...w, state: 'verified' as const })))
}
