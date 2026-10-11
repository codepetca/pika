/** Inert publication proof source. No import-time IO/SQL and no cleanup authority.
 * All assumptions require separately reviewed isolated native acceptance. */
import assert from 'node:assert/strict'
import { z } from 'zod'
import type { AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import { testOwnerDigest, testOwnerGuardSql } from './contextual-test-owner-detail-proof-fixture'
import { TEST_OWNER_PRISTINE_DISCARD_SNAPSHOT_TABLES } from './contextual-test-pristine-discard-proof-fixture'
import { contextualTestListTestSchema } from '../src/lib/validations/contextual-test-list-read'
import { contextualTestDraftGetRowSchema, contextualTestDraftGetQuestionSchema } from '../src/lib/validations/contextual-test-draft-get'
import { contextualTestPublicationResultSchema } from '../src/lib/validations/contextual-test-publication'
import { boundedAssignmentListJson } from '../src/lib/validations/contextual-assignment-list-read'
import { normalizeTestDocuments } from '../src/lib/test-documents'
import type { CourseBlueprintSnapshot } from '../src/lib/server/course-blueprint-versions'
import { normalizeCourseBlueprintAuthoringGuidance } from '../src/lib/course-blueprint-authoring-guidance'
import { normalizePlannedCourseSiteConfig } from '../src/lib/course-site-publishing'

export const TEST_OWNER_PUBLICATION_CAPS = Object.freeze({ sqlBytes: 524288, networkRequests: 24, rpcRequests: 24,
  storageRequests: 0, requestMs: 20000, requestBytes: 8388608, resultBytes: 8388608, operationBytes: 16777216,
  contentBytes: 2097152, bodyBytes: 16384, rowBytes: 2097152, snapshotBytes: 8388608, totalBytes: 67108864,
  snapshotRows: 100000, rowsPerTable: 10000, fingerprintTables: 1024, witnessIds: 24 })
export const TEST_OWNER_PUBLICATION_SNAPSHOT_TABLES = Object.freeze([...TEST_OWNER_PRISTINE_DISCARD_SNAPSHOT_TABLES,
  'public.course_blueprints', 'public.course_blueprint_versions', 'public.managed_storage_settings'])
const q = (s: string) => `'${s.replaceAll("'", "''")}'`
const uuid = z.string().uuid().refine(s => s === s.toLowerCase())
const timestamp = z.string().datetime({ offset: true }).refine(s => Number.isFinite(Date.parse(s)))
export const testOwnerPublicationQuestionSchema = contextualTestDraftGetQuestionSchema.extend({
  source_blueprint_version_id: uuid.nullable(), created_at: timestamp, updated_at: timestamp,
  ai_reference_cache_key: z.string().nullable(), ai_reference_cache_answers: z.array(z.string()).nullable(),
  ai_reference_cache_model: z.string().nullable(), ai_reference_cache_generated_at: timestamp.nullable(),
}).strict()
type Row = Record<string, unknown>
export type TestOwnerPublicationSnapshot = Record<string, Row[]>
type Question = z.infer<typeof testOwnerPublicationQuestionSchema>
function freeze<T>(v: T): T { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v) } return v }
const portable = (r: { source_artifact_id: string | null; artifact_id: string }) => r.source_artifact_id ?? r.artifact_id
const authoredKeys = ['question_type', 'question_text', 'options', 'correct_option', 'answer_key', 'sample_solution',
  'points', 'response_max_chars', 'response_monospace', 'position'] as const
function contentQuestion(r: Question) {
  return { id: portable(r), question_type: r.question_type, question_text: r.question_text, options: [...r.options],
    correct_option: r.correct_option, answer_key: r.answer_key, sample_solution: r.sample_solution, points: r.points,
    response_max_chars: r.response_max_chars, response_monospace: r.response_monospace }
}
/** Immutable Versions use the existing canonical JSON hash contract, not the
 * unrelated247 PostgreSQL-jsonb authoring digest contract. */
function canonicalVersion(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalVersion)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonicalVersion(x)]))
  return v
}
export function newTestOwnerPublicationFixture(original: AssignmentListProofFixture) {
  assert.match(original.manifest.syntheticTag, /^assignmentlist_[a-f0-9]{12}$/)
  assert(Number.isFinite(Date.parse(original.manifest.now))); assert(original.allocatedIds.length <= 20000)
  const tag = `testownerpublication_${original.manifest.syntheticTag.slice(-12)}`; const now = original.manifest.now
  const id = (label: string) => { const h = testOwnerDigest(`${tag}:${label}`); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}` }
  const actors = (['teacher', 'student', 'student', 'teacher'] as const).map((role, i) => ({ id: id(`actor${i}`), role, email: `${tag}_${i}@example.invalid` }))
  const classes = Array.from({ length: 6 }, (_, i) => ({ id: id(`class${i}`), owner: actors[i === 1 ? 1 : i === 2 ? 3 : 0].id,
    title: `${tag} Class ${i}`, code: `${tag}_${i}`, archived: i === 3 }))
  const labels = ['teacher-owner', 'student-owner-mixed', 'bulk-1001', 'student-member-denied', 'unrelated-owner-denied',
    'archived-class-denied', 'retired-test-denied', 'missing-draft', 'stale-version', 'noncanonical-content'] as const
  const transitionLabels = ['stale-draft', 'stale-authoring', 'metadata-preserved', 'owner-transfer', 'publication-start'] as const
  const allLabels = [...labels, 'capability-target', ...transitionLabels]
  const ci = (label: string) => label === 'student-owner-mixed' ? 1 : label === 'archived-class-denied' ? 3 : label === 'owner-transfer' ? 4 : label === 'publication-start' ? 5 : 0
  const tests = allLabels.map((label, position) => ({ id: id(`test:${label}`), artifact_id: id(`test-artifact:${label}`),
    classroom_id: classes[ci(label)].id, created_by: actors[3].id, title: `${tag} ${label}`, status: 'draft' as const,
    show_results: false, documents: [{ id: id(`document:${label}`), source: 'link', title: 'Synthetic source', url: 'https://example.invalid/source' }],
    position, points_possible: 17, include_in_final: false, created_at: now, updated_at: now, source_artifact_id: null,
    source_blueprint_version_id: null, blueprint_archived_at: label === 'retired-test-denied' ? now : null, questions_locked_at: null,
    gradebook_category_id: null, gradebook_weight: 23, gradebook_maximum_override: 19, gradebook_score_scale: 1.25 }))
  const blueprint = { id: id('blueprint'), teacher_id: actors[0].id, title: `${tag} lineage`, latest_version_number: 1 }
  const blueprintVersionId = id('blueprint-version')
  const questions: Question[] = tests.flatMap((test, index) => Array.from({ length: index === 2 ? 1001 : index === 1 ? 4 : 1 }, (_, position) => {
    const label = allLabels[index]; const retainedLineage = index === 1 && position === 0
    const mc = index === 1 && position === 1; const cache = index === 1 && !mc
    return { id: id(`question-row:${label}:${position}`), test_id: test.id, artifact_id: id(`question-artifact:${label}:${position}`),
      source_artifact_id: retainedLineage ? id('retained-source-artifact') : null,
      source_blueprint_version_id: retainedLineage ? blueprintVersionId : null,
      question_type: mc ? 'multiple_choice' as const : 'open_response' as const, question_text: `Synthetic question ${position}`,
      options: mc ? ['Synthetic choice one', 'Synthetic choice two'] : [], correct_option: mc ? 0 : null,
      answer_key: null, sample_solution: null, points: 1, response_max_chars: 500, response_monospace: false, position,
      created_at: now, updated_at: now, ai_reference_cache_key: cache ? `synthetic-cache-${position}` : null,
      ai_reference_cache_answers: cache ? ['Synthetic reference'] : null, ai_reference_cache_model: cache ? 'SyntheticModel' : null,
      ai_reference_cache_generated_at: cache ? now : null }
  }))
  const mixed = questions.filter(r => r.test_id === tests[1].id)
  const newQuestionPortableId = id('mixed-new-portable')
  const drafts = tests.filter((_, i) => i !== 7).map(test => {
    const content = { title: test.id === tests[1].id ? `${tag} mixed published` : test.title,
      show_results: test.id === tests[1].id, question_identity_version: 1,
      questions: questions.filter(r => r.test_id === test.id).map(contentQuestion) }
    if (test.id === tests[1].id) content.questions = [
      { ...contentQuestion(mixed[0]), question_text: 'Synthetic authored correction' }, contentQuestion(mixed[1]), contentQuestion(mixed[2]),
      { ...contentQuestion(mixed[3]), id: newQuestionPortableId, question_text: 'Synthetic newly materialized question' }]
    return { id: id(`draft:${test.id}`), assessment_type: 'test' as const, assessment_id: test.id, classroom_id: test.classroom_id,
      version: 3, content: test.id === tests[9].id ? { ...content, ignored_extra: true } : content,
      created_by: actors[3].id, updated_by: actors[3].id, created_at: now, updated_at: now }
  })
  const cases = labels.map((label, index) => ({ label, actorId: actors[index === 1 ? 1 : index === 3 ? 2 : index === 4 ? 3 : 0].id,
    testId: tests[index].id, input: { status: 'closed' as const, draft_version: index === 8 ? 4 : 3 },
    expectedHTTP: (index < 3 ? 200 : index < 7 ? 403 : index === 7 ? 404 : index === 8 ? 409 : 400) as 200 | 400 | 403 | 404 | 409 | 503,
    expectedRPCs: (index < 3 ? 2 : 1) as 1 | 2, Q: index === 1 ? 3 : 0, T: index === 1 ? 1 : 0 }))
  const privilegeProbes = (['snapshot247', 'publication252', 'legacy139', 'activation134'] as const).map((context, i) => ({
    label: `raw-42501-${context}`, context, actorId: actors[0].id, testId: tests[10].id,
    input: { status: 'closed' as const, draft_version: 3 }, expectedHTTP: 503 as const, expectedCode: '42501' as const,
    expectedRPCs: (i === 0 ? 1 : 2) as 1 | 2, Q: 0, T: 0 }))
  const transitions = transitionLabels.map((label, i) => ({ label, actorId: actors[0].id, testId: tests[11 + i].id,
    classroomId: tests[11 + i].classroom_id, questionId: questions.find(r => r.test_id === tests[11 + i].id)!.id,
    input: { status: 'closed' as const, draft_version: 3 }, nextOwnerId: actors[3].id,
    authoredText: `Synthetic committed authoring ${label}`, authoredTitle: `${tag} committed ${label}`,
    documents: [{ id: id(`transition-document:${label}`), source: 'link' as const, title: 'Committed metadata', url: 'https://example.invalid/committed' }],
    cacheKey: `committed-cache-${label}`, cacheAnswers: ['Committed synthetic reference'], cacheModel: 'CommittedSyntheticModel',
    expectedHTTP: (label === 'owner-transfer' ? 403 : label.startsWith('stale-') ? 409 : 200) as 200 | 403 | 409,
    Q: 0, T: 0 }))
  const enrollments = [{ id: id('member-enrollment'), classroom_id: classes[0].id, student_id: actors[2].id },
    { id: id('start-enrollment'), classroom_id: classes[5].id, student_id: actors[2].id }]
  const snapshotJson: CourseBlueprintSnapshot = { schema_version: 3, blueprint_id: blueprint.id, draft_revision: 1,
    metadata: { title: blueprint.title, subject: '', grade_level: '', course_code: '', term_template: '' },
    sections: { overview_markdown: '', outline_markdown: '', resources_markdown: '' },
    authoring_guidance: normalizeCourseBlueprintAuthoringGuidance(null),
    grading: { use_weights: false, assignments_weight: 70, tests_weight: 30 },
    planned_site: { slug: null, published: false, config: normalizePlannedCourseSiteConfig(null) },
    assignments: [], assessments: [{ artifact_id: tests[1].artifact_id, assessment_type: 'test', title: tests[1].title,
      content: { title: tests[1].title, show_results: false, question_identity_version: 1, questions: mixed.map(contentQuestion) },
      documents: [], points_possible: tests[1].points_possible, gradebook_weight: tests[1].gradebook_weight,
      include_in_final: tests[1].include_in_final, position: tests[1].position }], lesson_templates: [], materials: [], surveys: [] }
  const blueprintVersion = { id: blueprintVersionId, course_blueprint_id: blueprint.id, version_number: 1, source_draft_revision: 1,
    snapshot_schema_version: 3, snapshot_json: snapshotJson, snapshot_sha256: testOwnerDigest(JSON.stringify(canonicalVersion(snapshotJson))),
    source_kind: 'package', source_metadata: { synthetic: true }, created_by: actors[0].id, created_at: now }
  const reservedIds = { newQuestionPortableId, rollbackTestId: id('rollback-test'), rollbackDraftId: id('rollback-draft'),
    rollbackQuestionIds: Array.from({ length: 8 }, (_, i) => id(`rollback-question${i}`)), focusEventId: id('rollback-focus-event') }
  const allocatedIds = [...actors.map(r => r.id), ...classes.map(r => r.id), ...tests.flatMap(r => [r.id, r.artifact_id, String(r.documents[0].id)]),
    ...drafts.map(r => r.id), ...questions.flatMap(r => [r.id, r.artifact_id, ...(r.source_artifact_id ? [r.source_artifact_id] : [])]),
    ...enrollments.map(r => r.id), blueprint.id, blueprintVersion.id, ...transitions.map(r => r.documents[0].id),
    reservedIds.newQuestionPortableId, reservedIds.rollbackTestId, reservedIds.rollbackDraftId, ...reservedIds.rollbackQuestionIds, reservedIds.focusEventId]
  assert.equal(new Set(allocatedIds).size, allocatedIds.length); const old = new Set<string>(original.allocatedIds)
  assert(allocatedIds.every(value => !old.has(value))); assert.equal(cases.reduce((n, c) => n + c.expectedRPCs, 0), 13)
  assert.equal(privilegeProbes.reduce((n, c) => n + c.expectedRPCs, 0), 7)
  return freeze({ version: 1 as const, tag, now, actors, classes, tests, drafts, questions, enrollments, blueprint, blueprintVersion,
    cases, privilegeProbes, transitions, reservedIds, allocatedIds, forbiddenWitnessIds: [...original.allocatedIds, ...allocatedIds], nativeVerified: false as const,
    inventory: { actors: 4, classes: 6, tests: 16, drafts: 15, questions: questions.length, enrollments: 2,
      triggerCategories: 18, archiveRevisionRows: 6, cases: 10, privilegeProbes: 4, transitions: 5, sdkRPCs: 20 },
    caveats: ['Authoring SHA excludes raw metadata/caches; final locked full rows preserve latest state',
      'Writer sequence is nontransactional; never reset or claimed equal', 'No lost-ack retry/compensation or provider/Storage authority'] })
}
export type TestOwnerPublicationFixture = ReturnType<typeof newTestOwnerPublicationFixture>
function boundedSql(sql: string) { assert(Buffer.byteLength(sql) <= TEST_OWNER_PUBLICATION_CAPS.sqlBytes); return sql }
export function testOwnerPublicationSetupSql(f: TestOwnerPublicationFixture, projectId: string) {
  assert.equal(projectId, `pika_assignment_list_${f.tag.slice(-12)}`)
  const json = (v: unknown) => `${q(JSON.stringify(v))}::jsonb`
  const columns = (r: Row) => Object.keys(r).join(',')
  const value = (v: unknown): string => v === null ? 'null' : typeof v === 'string' ? q(v) : typeof v === 'object' ? json(v) : String(v)
  const insert = (table: string, rows: readonly Row[], omit: string[] = []) => {
    const keys = Object.keys(rows[0]).filter(k => !omit.includes(k))
    return `insert into ${table}(${keys.join(',')}) values ${rows.map(r => `(${keys.map(k => value(r[k])).join(',')})`).join(',')};`
  }
  const bulk = f.questions.filter(r => r.test_id === f.cases[2].testId)
  const small = f.questions.filter(r => r.test_id !== f.cases[2].testId)
  // Bulk rows use two fixed UUID arrays and source-derived ordinality, avoiding
  // a huge repeated full-row SQL literal while retaining the exact IDs/rows.
  const bulkColumns = columns(bulk[0]); const bulkValues = Object.entries(bulk[0]).map(([k, v]) => k === 'id' ? 'row_id'
    : k === 'artifact_id' ? 'artifact_id' : k === 'position' ? 'ordinal-1' : k === 'question_text' ? "'Synthetic question '||(ordinal-1)::text" : value(v)).join(',')
  return boundedSql(`${testOwnerGuardSql(projectId)}
begin;set local lock_timeout='3s';set local statement_timeout='30s';
do $collision$ declare owned uuid[]:=array[${f.allocatedIds.map(q).join(',')}]::uuid[];begin
 if ${['users', 'classrooms', 'tests', 'test_questions', 'assessment_drafts', 'classroom_enrollments', 'managed_storage_objects', 'course_blueprints', 'course_blueprint_versions'].map(t => `exists(select 1 from public.${t} where id=any(owned))`).join(' or ')}
 or exists(select 1 from public.users where email like ${q(f.tag + '%')})
 or exists(select 1 from public.classrooms where class_code like ${q(f.tag + '%')})
 or exists(select 1 from public.tests where classroom_id=any(owned) or artifact_id=any(owned) or source_artifact_id=any(owned))
 or exists(select 1 from public.assessment_drafts where classroom_id=any(owned) or assessment_id=any(owned))
 or exists(select 1 from public.test_questions where test_id=any(owned) or artifact_id=any(owned) or source_artifact_id=any(owned))
 or exists(select 1 from public.managed_storage_json_references where test_id=any(owned) or managed_object_id=any(owned))
 or exists(select 1 from public.classroom_guided_draft_provenance where test_id=any(owned) or draft_id=any(owned) or classroom_id=any(owned))
 or exists(select 1 from private.pal_membership_generations where generation_id=any(owned))
 then raise exception 'Publication namespace collision';end if;end;$collision$;
${insert('public.users', f.actors)}
insert into public.classrooms(id,teacher_id,title,class_code,feature_visibility) values ${f.classes.map(c => `(${q(c.id)},${q(c.owner)},${q(c.title)},${q(c.code)},'{"classwork":false}'::jsonb)`).join(',')};
${insert('public.classroom_enrollments', f.enrollments)}
${insert('public.course_blueprints', [f.blueprint])}
${insert('public.course_blueprint_versions', [f.blueprintVersion])}
${insert('public.tests', f.tests, ['gradebook_category_id'])}
${insert('public.test_questions', small)}
insert into public.test_questions(${bulkColumns}) select ${bulkValues} from unnest(array[${bulk.map(r => q(r.id)).join(',')}]::uuid[],array[${bulk.map(r => q(r.artifact_id)).join(',')}]::uuid[]) with ordinality as b(row_id,artifact_id,ordinal);
${insert('public.assessment_drafts', f.drafts)}
do $archive$ declare affected integer;begin update public.classrooms set archived_at=${q(f.now)} where id=${q(f.classes[3].id)} and teacher_id=${q(f.classes[3].owner)} and archived_at is null;
 get diagnostics affected=row_count;if affected<>1 then raise exception 'Publication archive setup differs';end if;end;$archive$;
commit;`)
}
export function testOwnerPublicationSnapshotSql(f: TestOwnerPublicationFixture) {
  const fixed = f.tests.map(t => q(t.id)).join(','); const classes = f.classes.map(c => q(c.id)).join(','); const actors = f.actors.map(a => q(a.id)).join(',')
  const current = 'select id from source_test_ids'; const test = `test_id in (${fixed}) or test_id in (${current})`; const ds = f.drafts.map(d => q(d.id)).join(',')
  const scopes: Array<[string, string]> = [
    ['public.users', `id in (${actors})`], ['public.classrooms', `id in (${classes})`], ['public.tests', `id in (${fixed}) or classroom_id in (${classes})`],
    ['public.gradebook_categories', `classroom_id in (${classes})`], ['public.test_questions', test],
    ['public.assessment_drafts', `id in (${ds}) or classroom_id in (${classes}) or assessment_id in (${fixed}) or assessment_id in (${current})`],
    ...['test_attempts', 'test_responses', 'test_student_availability'].map(t => [`public.${t}`, test] as [string, string]),
    ['public.classroom_enrollments', `classroom_id in (${classes})`], ['public.classroom_roster', `classroom_id in (${classes})`],
    ['public.classroom_archive_revisions', `classroom_id in (${classes})`],
    ['public.managed_storage_objects', `classroom_id in (${classes}) or resource_id in (${fixed}) or resource_id in (${current})`],
    ['public.managed_storage_json_references', test], ['public.test_document_snapshot_storage_cleanup', 'true'],
    ['public.pal_event_outbox', `student_id in (${actors})`], ['private.pal_membership_outbox', `classroom_id in (${classes}) or student_id in (${actors})`],
    ['private.pal_membership_generations', `generation_id in (${f.enrollments.map(e => q(e.id)).join(',')}) or scope_digest in (${f.classes.flatMap(c => f.actors.map(a => `private.pal_membership_scope(${q(c.id)}::uuid,${q(a.id)}::uuid)`)).join(',')})`],
    ...['pal_membership_settings', 'pal_classroom_signal_settings', 'student_provider_cleanup_settings', 'classroom_creation_entitlement_settings'].map(t => [`private.${t}`, 'true'] as [string, string]),
    ...['test_focus_events', 'test_ai_grading_runs', 'test_ai_grading_run_items'].map(t => [`public.${t}`, test] as [string, string]),
    ['public.test_attempt_history', `test_attempt_id in (select id from public.test_attempts where ${test})`],
    ['public.classroom_guided_draft_provenance', `${test} or classroom_id in (${classes}) or draft_id in (${ds})`],
    ['public.gradebook_score_overrides', `classroom_id in (${classes}) or (assessment_type='test' and assessment_id in (${fixed}))`],
    ['public.course_blueprints', `id=${q(f.blueprint.id)}`], ['public.course_blueprint_versions', `id=${q(f.blueprintVersion.id)} or course_blueprint_id=${q(f.blueprint.id)}`],
    ['public.managed_storage_settings', 'true'],
  ]
  assert.deepEqual(scopes.map(([t]) => t), TEST_OWNER_PUBLICATION_SNAPSHOT_TABLES)
  // Only permitted-mutating owned scopes are excluded; each complete row is
  // independently checked below. Draft/queues/Storage remain WHOLE fingerprints.
  const excludes: Record<string, string> = { 'public.classrooms': `where r.id not in (${classes})`,
    'public.classroom_archive_revisions': `where r.classroom_id not in (${classes})`,
    'public.tests': `where not (r.id in (${fixed}) or r.classroom_id in (${classes}))`,
    'public.test_questions': `where not (r.test_id in (${fixed}) or r.test_id in (select id from public.tests where classroom_id in (${classes})))`,
    // The single committed stale-draft transition legitimately changes one row.
    'public.assessment_drafts': `where r.id<>${q(f.drafts.find(d => d.assessment_id === f.transitions[0].testId)!.id)}::uuid` }
  const fingerprints = `(select coalesce(jsonb_agg(jsonb_build_object('table',n.nspname||'.'||c.relname,'fingerprint',query_to_xml(format('select count(*) as count,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'''' order by md5(to_jsonb(r)::text)),'''')) as digest from %I.%I r %s',n.nspname,c.relname,case ${Object.entries(excludes).map(([t, p]) => `when n.nspname||'.'||c.relname=${q(t)} then ${q(p)}`).join(' ')} else '' end),true,false,'')::text) order by n.nspname,c.relname),'[]'::jsonb) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname in ('public','private','storage'))`
  return boundedSql(`begin isolation level repeatable read read only;set local lock_timeout='3s';set local statement_timeout='30s';with source_test_ids as (select id from public.tests where id in (${fixed}) or classroom_id in (${classes})) select jsonb_build_object(${scopes.map(([t, p]) => `${q(t)},(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from ${t} r where ${p})`).join(',')},'__nontarget_fingerprints',${fingerprints});rollback;`)
}

function instant(v: unknown): string {
  const s = timestamp.parse(v); const fraction = /(?:\.(\d+))?(?:Z|[+-]\d{2}:\d{2})$/.exec(s)?.[1] ?? ''
  return `${Math.floor(Date.parse(s) / 1000)}:${fraction.replace(/0+$/, '')}`
}
function normalized(v: unknown, key = ''): unknown {
  if (typeof v === 'string' && key.endsWith('_at')) return instant(v)
  if (Array.isArray(v)) return v.map(x => normalized(x))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, normalized(x, k)]))
  return v
}
const canonical = (v: unknown) => JSON.stringify(normalized(v))
function equal(a: unknown, b: unknown) { assert.equal(canonical(a), canonical(b), 'Complete row differs') }
function sameRows(a: Row[], b: Row[]) { assert.deepEqual(a.map(canonical).sort(), b.map(canonical).sort(), 'Complete table rows differ') }
function signature(s: TestOwnerPublicationSnapshot) { return testOwnerDigest(JSON.stringify(Object.fromEntries(Object.entries(s).sort(([a], [b]) => a.localeCompare(b)).map(([t, rows]) => [t, rows.map(canonical).sort()])))) }
function indexed(rows: readonly Row[], key = 'id') {
  const pairs = rows.map(r => [uuid.parse(r[key]), r] as const); assert.equal(new Set(pairs.map(([id]) => id)).size, pairs.length)
  return new Map(pairs)
}
function snapshot(value: unknown): TestOwnerPublicationSnapshot {
  assert(boundedAssignmentListJson(value, TEST_OWNER_PUBLICATION_CAPS.snapshotBytes), 'Non-JSON/oversize full snapshot')
  const s = z.record(z.string(), z.array(z.record(z.string(), z.unknown())).max(TEST_OWNER_PUBLICATION_CAPS.rowsPerTable)).parse(value)
  assert.deepEqual(Object.keys(s).sort(), [...TEST_OWNER_PUBLICATION_SNAPSHOT_TABLES, '__nontarget_fingerprints'].sort())
  assert(Object.values(s).reduce((n, rows) => n + rows.length, 0) <= TEST_OWNER_PUBLICATION_CAPS.snapshotRows)
  const fingerprints = z.array(z.object({ table: z.string().regex(/^(public|private|storage)\.[a-z_0-9]+$/), fingerprint: z.string().min(1).max(4096) }).strict())
    .min(1).max(TEST_OWNER_PUBLICATION_CAPS.fingerprintTables).parse(s.__nontarget_fingerprints)
  assert.equal(new Set(fingerprints.map(r => r.table)).size, fingerprints.length)
  for (const t of [...TEST_OWNER_PUBLICATION_SNAPSHOT_TABLES, 'storage.objects', 'storage.buckets']) assert(fingerprints.some(r => r.table === t), 'Incomplete table catalog')
  s['public.tests'].forEach(r => contextualTestListTestSchema.parse(r))
  s['public.assessment_drafts'].forEach(r => contextualTestDraftGetRowSchema.parse(r))
  s['public.test_questions'].forEach(r => testOwnerPublicationQuestionSchema.parse(r))
  return s
}
function plannedRows(actual: Row[], expected: readonly Row[], key = 'id', full = false) {
  const a = indexed(actual, key); assert.equal(a.size, expected.length)
  for (const r of expected) {
    const found = a.get(String(r[key])); assert(found)
    if (full) equal(found, r)
    else for (const [k, v] of Object.entries(r)) equal({ [k]: found[k] }, { [k]: v })
  }
}
function setupBaseline(f: TestOwnerPublicationFixture, s: TestOwnerPublicationSnapshot) {
  const categories = s['public.gradebook_categories']; assert.equal(indexed(categories).size, f.inventory.triggerCategories)
  for (const c of f.classes) assert.equal(categories.filter(r => r.classroom_id === c.id).length, 3)
  const expectedTests = f.tests.map(t => {
    const sorted = categories.filter(c => c.classroom_id === t.classroom_id).sort((a, b) => Number(b.is_default) - Number(a.is_default) || Number(a.position) - Number(b.position) || String(a.id).localeCompare(String(b.id)))
    return { ...t, gradebook_category_id: sorted[0]?.id ?? null }
  })
  plannedRows(s['public.tests'], expectedTests, 'id', true)
  plannedRows(s['public.test_questions'], f.questions, 'id', true)
  plannedRows(s['public.assessment_drafts'], f.drafts, 'id', true)
  plannedRows(s['public.users'], f.actors); plannedRows(s['public.classroom_enrollments'], f.enrollments)
  plannedRows(s['public.course_blueprints'], [f.blueprint]); plannedRows(s['public.course_blueprint_versions'], [f.blueprintVersion], 'id', true)
  const classes = indexed(s['public.classrooms']); const revisions = indexed(s['public.classroom_archive_revisions'], 'classroom_id')
  assert.equal(classes.size, f.classes.length); assert.equal(revisions.size, f.classes.length)
  for (const c of f.classes) {
    const r = classes.get(c.id); assert(r && revisions.has(c.id)); assert.equal(r.teacher_id, c.owner); assert.equal(r.title, c.title); assert.equal(r.class_code, c.code)
    equal({ archived_at: r.archived_at }, { archived_at: c.archived ? f.now : null })
    assert(Number.isSafeInteger(r.blueprint_source_revision) && Number(r.blueprint_source_revision) >= 0); instant(r.updated_at)
    const archive = revisions.get(c.id)!; assert(Number.isSafeInteger(archive.revision) && Number(archive.revision) >= 0); instant(archive.updated_at)
  }
  assert.equal(s['public.managed_storage_settings'].length, 1); assert.equal(s['public.managed_storage_settings'][0].singleton, true)
  for (const t of ['public.test_attempts', 'public.test_responses', 'public.test_student_availability', 'public.test_focus_events',
    'public.test_ai_grading_runs', 'public.test_ai_grading_run_items', 'public.test_attempt_history', 'public.managed_storage_objects',
    'public.managed_storage_json_references', 'public.classroom_guided_draft_provenance', 'public.gradebook_score_overrides']) assert.equal(s[t].length, 0)
}
export function validateTestOwnerPublicationSetupSnapshot(f: TestOwnerPublicationFixture, value: unknown, expectedTables: readonly string[]) {
  const s = snapshot(value)
  assert(expectedTables.length > 0 && expectedTables.length <= TEST_OWNER_PUBLICATION_CAPS.fingerprintTables)
  assert(expectedTables.every(t => /^(public|private|storage)\.[a-z_0-9]+$/.test(t))); assert.equal(new Set(expectedTables).size, expectedTables.length)
  assert.deepEqual(s.__nontarget_fingerprints.map(r => r.table).sort(), [...expectedTables].sort(), 'Complete external table catalog differs')
  setupBaseline(f, s); return s
}
type Envelope = z.infer<typeof contextualTestPublicationResultSchema>
type Window = Readonly<{ startMs: number; deadlineMs: number }>
export type TestOwnerPublicationWitness = Readonly<{ kind: 'publication' | 'transition'; caseLabel: string;
  state: 'provisional' | 'verified'; envelope: Envelope | null; requestWindow: Window | null }>
const issued = new WeakSet<object>(); const snapshots = new WeakMap<object, string>(); const fixtureBindings = new WeakMap<object, string>()
function ledger(f: TestOwnerPublicationFixture, entries: readonly TestOwnerPublicationWitness[]) {
  assert(Array.isArray(entries) && entries.length <= TEST_OWNER_PUBLICATION_CAPS.witnessIds)
  assert(entries.length === 0 || issued.has(entries), 'Unissued/cloned ledger')
  if (issued.has(entries)) assert.equal(fixtureBindings.get(entries), testOwnerDigest(JSON.stringify(f)), 'Ledger fixture differs')
}
function issue(f: TestOwnerPublicationFixture, entries: TestOwnerPublicationWitness[], after?: TestOwnerPublicationSnapshot) {
  const result = freeze(entries); issued.add(result); fixtureBindings.set(result, testOwnerDigest(JSON.stringify(f)))
  if (after) snapshots.set(result, signature(after)); return result
}
function beforeState(f: TestOwnerPublicationFixture, before: TestOwnerPublicationSnapshot, entries: readonly TestOwnerPublicationWitness[]) {
  ledger(f, entries); const pinned = snapshots.get(entries)
  if (pinned) assert.equal(signature(before), pinned, 'Previous verified whole snapshot differs')
  else setupBaseline(f, before)
}
function window(value?: Window): Window {
  const startMs = Date.now(); const w = value ?? { startMs, deadlineMs: startMs + TEST_OWNER_PUBLICATION_CAPS.requestMs }
  assert(Number.isSafeInteger(w.startMs) && Number.isSafeInteger(w.deadlineMs) && w.deadlineMs > w.startMs && w.deadlineMs - w.startMs <= TEST_OWNER_PUBLICATION_CAPS.requestMs)
  return { ...w }
}
function envelope(f: TestOwnerPublicationFixture, c: { actorId: string; testId: string; input: { draft_version: number } }, value: unknown, sha: unknown): Envelope {
  assert(boundedAssignmentListJson(value, TEST_OWNER_PUBLICATION_CAPS.resultBytes)); const e = contextualTestPublicationResultSchema.parse(value)
  assert.equal(e.actor_id, c.actorId); assert.equal(e.test_id, c.testId); assert.equal(e.test.id, c.testId)
  assert.equal(e.classroom_id, f.tests.find(t => t.id === c.testId)!.classroom_id); assert.equal(e.test.classroom_id, e.classroom_id)
  assert.equal(e.draft_version, c.input.draft_version); assert.equal(e.test.status, 'closed'); assert.equal(e.test.blueprint_archived_at, null)
  assert.equal(e.test.questions_locked_at, null); assert.match(z.string().parse(sha), /^[a-f0-9]{64}$/); assert.equal(e.source_sha256, sha)
  return e
}
export function registerTestOwnerPublicationWitness(f: TestOwnerPublicationFixture, prior: TestOwnerPublicationWitness[], caseLabel: string,
  value: unknown, rawRequestWindow?: Window, expectedSourceSha256?: string) {
  ledger(f, prior); assert(prior.every(w => w.state === 'verified')); assert(!prior.some(w => w.caseLabel === caseLabel))
  const c = f.cases.find(c => c.label === caseLabel); assert(c && c.expectedHTTP === 200)
  const e = envelope(f, c, value, expectedSourceSha256)
  const result = issue(f, [...prior, { kind: 'publication', caseLabel, envelope: e, state: 'provisional', requestWindow: window(rawRequestWindow) }])
  const previous = snapshots.get(prior); if (previous) snapshots.set(result, previous); return result
}
function publicationEffects(f: TestOwnerPublicationFixture, before: TestOwnerPublicationSnapshot, after: TestOwnerPublicationSnapshot,
  c: { actorId: string; testId: string; Q: number; T: number }, e: Envelope, requestWindow: Window | null, effectTimestamp?: string) {
  const test = before['public.tests'].find(r => r.id === c.testId); assert(test && test.status === 'draft')
  const draft = contextualTestDraftGetRowSchema.parse(before['public.assessment_drafts'].find(r => r.assessment_type === 'test' && r.assessment_id === c.testId))
  assert.equal(draft.version, e.draft_version); const content = z.object({ title: z.string(), show_results: z.boolean(), questions: z.array(z.record(z.string(), z.unknown())) }).passthrough().parse(draft.content)
  const stamp = e.test.updated_at; if (effectTimestamp !== undefined) assert.equal(instant(stamp), instant(effectTimestamp))
  if (requestWindow) assert(Date.parse(stamp) >= requestWindow.startMs && Date.parse(stamp) <= requestWindow.deadlineMs, 'Transaction timestamp outside rooted request')
  equal(e.test, { ...test, title: content.title, show_results: content.show_results, status: 'closed', updated_at: stamp })
  sameRows(after['public.tests'], before['public.tests'].map(r => r.id === c.testId ? { ...e.test } : r))
  const oldQuestions = before['public.test_questions'].filter(r => r.test_id === c.testId).map(r => testOwnerPublicationQuestionSchema.parse(r))
  const newQuestions = after['public.test_questions'].filter(r => r.test_id === c.testId).map(r => testOwnerPublicationQuestionSchema.parse(r))
  const oldByPortable = new Map(oldQuestions.map(r => [portable(r), r])); assert.equal(oldByPortable.size, oldQuestions.length)
  const newByPortable = new Map(newQuestions.map(r => [portable(r), r])); assert.equal(newByPortable.size, newQuestions.length)
  assert.equal(newQuestions.length, content.questions.length); const expected: Row[] = []; let mutations = 0
  for (let position = 0; position < content.questions.length; position++) {
    const candidate = content.questions[position]; const identity = uuid.parse(candidate.id); const old = oldByPortable.get(identity); const current = newByPortable.get(identity); assert(current)
    const authored = Object.fromEntries(authoredKeys.map(k => [k, k === 'position' ? position : candidate[k]]))
    if (old) {
      const changed = authoredKeys.some(k => canonical(old[k]) !== canonical(authored[k])); if (changed) mutations++
      expected.push({ ...old, ...authored, updated_at: changed ? stamp : old.updated_at })
    } else {
      assert.match(current.id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
      assert(!f.forbiddenWitnessIds.includes(current.id) && !before['public.test_questions'].some(r => r.id === current.id)); mutations++
      expected.push({ id: current.id, test_id: c.testId, artifact_id: identity, source_artifact_id: null, source_blueprint_version_id: null,
        ...authored, created_at: stamp, updated_at: stamp, ai_reference_cache_key: null, ai_reference_cache_answers: null,
        ai_reference_cache_model: null, ai_reference_cache_generated_at: null })
    }
  }
  mutations += oldQuestions.filter(r => !newByPortable.has(portable(r))).length
  assert.equal(mutations, c.Q); assert.equal(Number(test.title !== content.title || test.show_results !== content.show_results), c.T)
  sameRows(after['public.test_questions'], [...before['public.test_questions'].filter(r => r.test_id !== c.testId), ...expected])
  for (const [table, key, revision, delta] of [['public.classrooms', 'id', 'blueprint_source_revision', c.T + c.Q],
    ['public.classroom_archive_revisions', 'classroom_id', 'revision', 2 + c.T + 2 * c.Q]] as const) {
    sameRows(after[table], before[table].map(r => {
      if (r[key] !== e.classroom_id) return r
      assert(Number.isSafeInteger(r[revision]) && Number(r[revision]) <= Number.MAX_SAFE_INTEGER - delta)
      if (table === 'public.classrooms') assert(r.teacher_id === c.actorId && r.archived_at === null)
      return { ...r, [revision]: Number(r[revision]) + delta, ...(delta > 0 ? { updated_at: stamp } : {}) }
    }))
  }
  for (const t of Object.keys(before)) if (!['public.tests', 'public.test_questions', 'public.classrooms', 'public.classroom_archive_revisions'].includes(t)) sameRows(before[t], after[t])
}
export function verifyTestOwnerPublicationEffects(f: TestOwnerPublicationFixture, beforeValue: unknown, afterValue: unknown,
  caseLabel: string, entries: TestOwnerPublicationWitness[], publicResult?: unknown, effectTimestamp?: string) {
  ledger(f, entries); const before = snapshot(beforeValue); const after = snapshot(afterValue)
  const c = [...f.cases, ...f.privilegeProbes].find(c => c.label === caseLabel); assert(c)
  const w = entries.find(w => w.caseLabel === caseLabel); const prior = entries.filter(w => w !== entries.at(-1) || entries.at(-1)?.state !== 'provisional')
  assert(prior.every(w => w.state === 'verified')); beforeState(f, before, entries)
  if (c.expectedHTTP !== 200) {
    assert(!w); assert.equal(publicResult, undefined); for (const t of Object.keys(before)) sameRows(before[t], after[t])
    return issue(f, [...entries], after)
  }
  assert(w && w.kind === 'publication' && w.state === 'provisional' && entries.at(-1) === w && w.envelope && w.requestWindow)
  publicationEffects(f, before, after, c, w.envelope, w.requestWindow, effectTimestamp)
  equal(publicResult, { test: { ...w.envelope.test, documents: normalizeTestDocuments(w.envelope.test.documents), assessment_type: 'test' } })
  return issue(f, entries.map(v => v === w ? { ...v, state: 'verified' } : v), after)
}

export type TestOwnerPublicationTransitionEvidence = Readonly<{ writerTimestamp?: string; publicationTimestamp?: string;
  sourceSha256?: string; envelope?: unknown; code?: 'PT409' | 'PT403' }>
export function verifyTestOwnerPublicationTransitionEffects(f: TestOwnerPublicationFixture, beforeValue: unknown, writerValue: unknown,
  afterValue: unknown, label: string, entries: TestOwnerPublicationWitness[], evidence: unknown) {
  ledger(f, entries); assert(entries.every(w => w.state === 'verified') && !entries.some(w => w.caseLabel === label))
  const c = f.transitions.find(c => c.label === label); assert(c)
  const before = snapshot(beforeValue); const writer = snapshot(writerValue); const after = snapshot(afterValue); beforeState(f, before, entries)
  const sealedEvidence = z.object({ writerTimestamp: timestamp.optional(), publicationTimestamp: timestamp.optional(),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(), envelope: z.unknown().optional(), code: z.enum(['PT409', 'PT403']).optional() }).strict().parse(evidence)
  const expected = structuredClone(before); const stamp = sealedEvidence.writerTimestamp
  if (label === 'publication-start') { assert.equal(stamp, undefined); for (const t of Object.keys(before)) sameRows(before[t], writer[t]) }
  else {
    assert(stamp); const test = expected['public.tests'].find(r => r.id === c.testId)!; assert(test)
    const question = expected['public.test_questions'].find(r => r.id === c.questionId)!; assert(question)
    let blueprintDelta = 0; let archiveDelta = 0
    if (label === 'stale-draft') {
      const draft = expected['public.assessment_drafts'].find(r => r.assessment_id === c.testId)!; assert(draft)
      draft.content = { ...z.record(z.string(), z.unknown()).parse(draft.content), title: c.authoredTitle }
      draft.version = Number(draft.version) + 1; draft.updated_at = stamp; blueprintDelta = 1; archiveDelta = 2
    } else if (label === 'stale-authoring') { question.question_text = c.authoredText; question.updated_at = stamp; blueprintDelta = 1; archiveDelta = 2 }
    else if (label === 'metadata-preserved') {
      test.documents = structuredClone(c.documents); test.updated_at = stamp
      question.ai_reference_cache_key = c.cacheKey; question.ai_reference_cache_answers = [...c.cacheAnswers]
      question.ai_reference_cache_model = c.cacheModel; question.ai_reference_cache_generated_at = stamp; question.updated_at = stamp
      blueprintDelta = 1; archiveDelta = 3
    } else { assert.equal(label, 'owner-transfer'); expected['public.classrooms'].find(r => r.id === c.classroomId)!.teacher_id = c.nextOwnerId; archiveDelta = 1 }
    const classroom = expected['public.classrooms'].find(r => r.id === c.classroomId)!; assert(classroom)
    if (blueprintDelta || label === 'owner-transfer') classroom.updated_at = stamp
    classroom.blueprint_source_revision = Number(classroom.blueprint_source_revision) + blueprintDelta
    const archive = expected['public.classroom_archive_revisions'].find(r => r.classroom_id === c.classroomId)!; assert(archive)
    archive.revision = Number(archive.revision) + archiveDelta; archive.updated_at = stamp
    for (const t of Object.keys(expected)) sameRows(expected[t], writer[t])
  }
  let e: Envelope | null = null
  if (c.expectedHTTP === 200) {
    assert.equal(sealedEvidence.code, undefined); assert(sealedEvidence.publicationTimestamp)
    e = envelope(f, c, sealedEvidence.envelope, sealedEvidence.sourceSha256)
    publicationEffects(f, writer, after, c, e, null, sealedEvidence.publicationTimestamp)
  } else {
    assert.equal(sealedEvidence.code, c.expectedHTTP === 403 ? 'PT403' : 'PT409')
    assert.equal(sealedEvidence.envelope, undefined); assert.equal(sealedEvidence.publicationTimestamp, undefined)
    for (const t of Object.keys(writer)) sameRows(writer[t], after[t])
  }
  return issue(f, [...entries, { kind: 'transition', caseLabel: label, state: 'verified', envelope: e, requestWindow: null }], after)
}
