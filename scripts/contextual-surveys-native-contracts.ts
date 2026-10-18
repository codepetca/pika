/** Survey263 source profile. Import is inert; no target or execution authority.
 * Rollback evidence is deliberately distinct from outstanding committed proof. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import type { AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import { loadAssignmentListReviewedMigrations, assignmentListSnapshotSql } from './contextual-assignment-list-proof-platform'
import { testOwnerGuardSql } from './contextual-test-owner-detail-proof-fixture'
import { contextualSurveysConcurrencyCases } from './contextual-surveys-concurrency-cases'
import type { DraftSaveDriver, DraftSaveSession, DraftSaveTarget } from './check-contextual-test-draft-save-db-contracts'
import type { Database } from '../src/types/database'
import { surveySdkProofManifest, survey269ComponentSdkProofManifest, SURVEY_269_COMPONENT_SDK_CAPS } from './contextual-surveys-sdk-proof'
import { surveyCommittedProofManifest } from './contextual-surveys-committed-proof'

export const SURVEY_NATIVE_SOURCES = freeze({
  migration: { file: 'supabase/migrations/263_contextual_surveys_workflow.sql', sha256: '1db152f8c33d239bf18b9fc61bab6da8896f2d9c88fa0fdce12c8671c30770c9' },
  contracts: { file: 'scripts/contextual-surveys-db-contracts.sql', sha256: 'd0e71b2e598b179e2947f34ee7023da7dc9ce29582db1faffefb3cc0ef385ec0' },
  sdk: { file: 'scripts/contextual-surveys-sdk-contracts.ts', sha256: '653ff7e1e4aec166808a1406a862d3f45ef2e109b4cec24b355e0a6e56f28538' },
  races: { file: 'scripts/contextual-surveys-concurrency-cases.ts', sha256: 'cb4e300bbbc4f8bae32144775a57912ff9e3d524af2b9fb9a8d1e7a3c2ab3e53' },
  sdkProof: { file: 'scripts/contextual-surveys-sdk-proof.ts', sha256: 'fea6313bddbee03e26d33cdcf257015f8e05d0d04443f0bd2aeb0debaf7ac5c1' },
})
export const SURVEY_NATIVE_CAPS = Object.freeze({ sqlBytes: 256 * 1024, responseBytes: 8 * 1024 * 1024,
  schedules: 30, sessions: 2, actionMs: 35000, closeMs: 12000, sdkRequests: 16, sdkMs: 20000 })
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
export const SURVEY_RPC_ARGUMENTS = freeze({
  get_surveys_for_owner_v1: ['p_actor_id', 'p_classroom_id'],
  get_surveys_for_member_v1: ['p_actor_id', 'p_classroom_id'],
  get_survey_for_owner_v1: ['p_actor_id', 'p_survey_id'],
  get_survey_for_member_v1: ['p_actor_id', 'p_survey_id'],
  get_survey_results_for_owner_v1: ['p_actor_id', 'p_survey_id'],
  get_survey_results_for_member_v1: ['p_actor_id', 'p_survey_id'],
  delete_survey_for_owner_v1: ['p_actor_id', 'p_survey_id'],
  update_survey_for_owner_v1: ['p_actor_id', 'p_survey_id', 'p_patch'],
  create_survey_question_for_owner_v1: ['p_actor_id', 'p_survey_id', 'p_question'],
  update_survey_question_for_owner_v1: ['p_actor_id', 'p_survey_id', 'p_question_id', 'p_expected_question', 'p_question'],
  delete_survey_question_for_owner_v1: ['p_actor_id', 'p_survey_id', 'p_question_id'],
  respond_to_survey_for_member_v1: ['p_actor_id', 'p_survey_id', 'p_classroom_id', 'p_expected_questions', 'p_responses'],
})
/** Same AST contract checks used by the existing owner publication verifier.
 * Structure alone is not provenance: the guarded genuine generator owns it. */
export function validateSurveyGeneratedTypes(source: string, expectedSha256: string) {
  assert(Buffer.byteLength(source) <= SURVEY_NATIVE_CAPS.responseBytes)
  assert.equal(digest(source), expectedSha256)
  const syntax = ts.transpileModule(source, { reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext } })
  assert(!syntax.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error))
  const tree = ts.createSourceFile('generated.ts', source, ts.ScriptTarget.Latest, true)
  const declarations = tree.statements.filter(ts.isTypeAliasDeclaration).filter(n => n.name.text === 'Database')
  assert.equal(declarations.length, 1)
  assert(declarations[0].modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword))
  const field = (node: ts.TypeNode, name: string): ts.TypeNode => {
    assert(ts.isTypeLiteralNode(node))
    const found = node.members.filter(ts.isPropertySignature).filter(m => m.name.getText(tree) === name)
    assert.equal(found.length, 1); assert(!found[0].questionToken && found[0].type)
    return found[0].type
  }
  const functions = field(field(declarations[0].type, 'public'), 'Functions')
  const jsonFields = new Set(['p_patch', 'p_question', 'p_expected_question', 'p_expected_questions', 'p_responses'])
  for (const [name, expected] of Object.entries(SURVEY_RPC_ARGUMENTS)) {
    const contract = field(functions, name)
    assert(ts.isTypeLiteralNode(contract))
    assert.deepEqual(contract.members.map(m => m.name?.getText(tree)).sort(), ['Args', 'Returns'])
    const args = field(contract, 'Args'); assert(ts.isTypeLiteralNode(args))
    assert.deepEqual(args.members.map(m => m.name?.getText(tree)).sort(), [...expected].sort())
    for (const arg of args.members) {
      assert(ts.isPropertySignature(arg) && !arg.questionToken && arg.type)
      if (jsonFields.has(arg.name.getText(tree))) assert(ts.isTypeReferenceNode(arg.type)
        && arg.type.typeName.getText(tree) === 'Json' && !arg.type.typeArguments)
      else assert.equal(arg.type.kind, ts.SyntaxKind.StringKeyword)
    }
    const returns = field(contract, 'Returns')
    assert(ts.isTypeReferenceNode(returns) && returns.typeName.getText(tree) === 'Json' && !returns.typeArguments)
  }
  return true
}
const q = (value: string) => `'${value.replaceAll("'", "''")}'`
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
function checked(repository: string, source: { file: string; sha256: string }) {
  const bytes = readFileSync(resolve(repository, source.file))
  assert.equal(digest(bytes), source.sha256, 'Survey reviewed source differs')
  return bytes.toString('utf8')
}
const sourcePlans = new WeakMap<object, object>()
function sealed(plan: SurveyNativePlan | Survey269ComponentPlan) {
  const original = sourcePlans.get(plan.contracts)
  return original !== undefined && Object.isFrozen(plan) && Object.keys(original).every(key =>
    plan[key as keyof SurveyNativePlan] === (original as SurveyNativePlan)[key as keyof SurveyNativePlan])
}
export function validateSurveyNativeMigrationProfile(migrations: ReturnType<typeof loadAssignmentListReviewedMigrations>) {
  assert.equal(migrations.length, 263, 'Only exact Survey263 extension is admitted')
  migrations.forEach((migration, index) => {
    assert(migration.name.startsWith(`${String(index + 1).padStart(3, '0')}_`))
    assert.equal(digest(migration.sql), migration.sha256, 'Survey migration bytes differ')
  })
  assert.equal(digest(JSON.stringify(migrations.slice(0, 262).map(({ name, sha256 }) => ({ name, sha256 })))),
    'ecd31cace5f9dbc892570ebcdb79617b5b7a5bf8a02b98e7283d769a9da840ac', 'Survey foundation differs')
  const last = migrations[262]
  assert.equal(last.name, '263_contextual_surveys_workflow.sql')
  assert.equal(last.sha256, SURVEY_NATIVE_SOURCES.migration.sha256)
  assert.equal(digest(last.sql), last.sha256)
}

export function newSurveyNativeFixture(original: AssignmentListProofFixture) {
  assert.match(original.manifest.syntheticTag, /^assignmentlist_[a-f0-9]{12}$/)
  const tag = `surveynative_${original.manifest.syntheticTag.slice(-12)}`
  const id = (label: string) => { const hex = digest(`${tag}:${label}`); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}` }
  const actors = (['student', 'teacher', 'student', 'student'] as const).map((role, index) => ({ id: id(`actor:${index}`), role, email: `${tag}_${index}@example.invalid` }))
  const classes = [0, 1].map(index => ({ id: id(`class:${index}`), owner: actors[index].id, code: `${tag}_${index}` }))
  const enrollments = [[0, 0], [0, 1], [1, 0], [1, 1], [0, 3]].map(([c, a], index) => ({ id: id(`enrollment:${index}`), classroomId: classes[c].id, actorId: actors[a].id }))
  const surveys = [0, 1, 2].map(index => ({ id: id(`survey:${index}`), classroomId: classes[index === 1 ? 1 : 0].id,
    owner: actors[index === 1 ? 1 : 0].id }))
  const question = { id: id('question'), artifact_id: id('question-artifact'), source_artifact_id: null, source_blueprint_version_id: null,
    survey_id: surveys[0].id, question_type: 'short_text', question_text: 'Synthetic native question',
    options: [], response_max_chars: 500, position: 0, created_at: '2026-10-12T00:00:00+00:00', updated_at: '2026-10-12T00:00:00+00:00' } satisfies Database['public']['Tables']['survey_questions']['Row']
  const replacementEnrollment = { id: id('membership-replacement'), classroomId: classes[0].id, actorId: actors[1].id }
  const aggregateQuestion = { ...question, id: id('aggregate-question'), artifact_id: id('aggregate-question-artifact'),
    survey_id: surveys[2].id, question_text: 'Synthetic shared result question' }
  const aggregateResponse = { id: id('aggregate-response'), surveyId: surveys[2].id, questionId: aggregateQuestion.id,
    actorId: actors[1].id, text: 'Synthetic shared result' }
  const allocatedIds = [...actors.map(row => row.id), ...classes.map(row => row.id), ...enrollments.map(row => row.id), ...surveys.map(row => row.id),
    question.id, question.artifact_id, aggregateQuestion.id, aggregateQuestion.artifact_id, aggregateResponse.id, replacementEnrollment.id]
  assert.equal(new Set(allocatedIds).size, allocatedIds.length)
  const originalIds = new Set<string>(original.allocatedIds)
  assert(allocatedIds.every(value => !originalIds.has(value)))
  return freeze({ version: 1, tag, projectId: `pika_assignment_list_${tag.slice(-12)}`, actors, classes, enrollments, surveys, question,
    aggregateQuestion, aggregateResponse, replacementEnrollment, allocatedIds })
}
export type SurveyNativeFixture = ReturnType<typeof newSurveyNativeFixture>

export function surveyNativePlan(original: AssignmentListProofFixture, reviewedHead: string, repository: string) {
  assert.match(reviewedHead, /^[a-f0-9]{40}$/)
  const migrations = loadAssignmentListReviewedMigrations(repository)
  validateSurveyNativeMigrationProfile(migrations)
  for (const source of Object.values(SURVEY_NATIVE_SOURCES)) checked(repository, source)
  const fixture = newSurveyNativeFixture(original), f = fixture
  const guard = testOwnerGuardSql(f.projectId)
  const actors = f.actors.map(row => q(row.id)).join(','), classes = f.classes.map(row => q(row.id)).join(',')
  const setup = `${guard}\nbegin;set local timezone='UTC';set local statement_timeout='30s';set local lock_timeout='1s';
do $collision$ begin
 if exists(select 1 from public.users where id in (${actors}) or email like ${q(f.tag + '%')})
 or exists(select 1 from public.classrooms where id in (${classes}) or class_code like ${q(f.tag + '%')})
 or exists(select 1 from public.surveys where id in (${f.surveys.map(row => q(row.id)).join(',')}) or classroom_id in (${classes}))
 or exists(select 1 from public.survey_questions where id in (${q(f.question.id)},${q(f.aggregateQuestion.id)}))
 or exists(select 1 from public.survey_responses where id=${q(f.aggregateResponse.id)})
 then raise exception 'Survey namespace collision';end if;
end;$collision$;
insert into public.users(id,email,role) values ${f.actors.map(row => `(${q(row.id)},${q(row.email)},${q(row.role)})`).join(',')};
insert into public.classrooms(id,teacher_id,title,class_code) values ${f.classes.map(row => `(${q(row.id)},${q(row.owner)},${q(f.tag)},${q(row.code)})`).join(',')};
insert into public.classroom_enrollments(id,classroom_id,student_id) values ${f.enrollments.map(row => `(${q(row.id)},${q(row.classroomId)},${q(row.actorId)})`).join(',')};
insert into public.surveys(id,classroom_id,created_by,title,status,show_results,dynamic_responses,opens_at) values ${f.surveys.map(row => `(${q(row.id)},${q(row.classroomId)},${q(row.owner)},${q(f.tag)},'active',true,false,'2026-10-12T00:00:00Z')`).join(',')};
insert into public.survey_questions(id,artifact_id,survey_id,question_type,question_text,options,response_max_chars,position,created_at,updated_at)
 values ${[f.question, f.aggregateQuestion].map(row => `(${q(row.id)},${q(row.artifact_id)},${q(row.survey_id)},'short_text',${q(row.question_text)},'[]'::jsonb,500,0,'2026-10-12T00:00:00Z','2026-10-12T00:00:00Z')`).join(',')};
insert into public.survey_responses(id,survey_id,question_id,student_id,response_text,submitted_at,updated_at)
 values (${q(f.aggregateResponse.id)},${q(f.aggregateResponse.surveyId)},${q(f.aggregateResponse.questionId)},${q(f.aggregateResponse.actorId)},${q(f.aggregateResponse.text)},'2026-10-12T00:00:00Z','2026-10-12T00:00:00Z');commit;`
  // Complete independent rows plus168 metadata/settings/cron, decoded by the
  // existing platform helper for the later concrete committed SDK operation.
  const snapshot = assignmentListSnapshotSql('rows')
  const cases = contextualSurveysConcurrencyCases({ ownerId: f.actors[0].id, memberId: f.actors[1].id, resultReaderId: f.actors[3].id,
    resultSurveyId: f.surveys[2].id,
    classroomId: f.classes[0].id, surveyId: f.surveys[0].id, questionId: f.question.id, foreignSurveyId: f.surveys[1].id },
  { expectedQuestions: [f.question], responses: { [f.question.id]: { question_type: 'short_text', response_text: 'Synthetic response' } } })
  assert.equal(cases.length, 15)
  const begin = "begin;set local timezone='UTC';set local statement_timeout='8s';set local lock_timeout='1s';set local idle_in_transaction_session_timeout='180s';"
  const observe = `select jsonb_build_object('held',exists(select 1 from pg_catalog.pg_locks where pid=pg_backend_pid() and granted
 and (locktype='advisory' or (locktype='relation' and relation in ('public.classrooms'::regclass,'public.classroom_archive_revisions'::regclass,'public.surveys'::regclass,'public.survey_questions'::regclass,'public.classroom_enrollments'::regclass) and mode in ('RowShareLock','RowExclusiveLock')))),
 'transaction',exists(select 1 from pg_catalog.pg_stat_activity where pid=pg_backend_pid() and xact_start is not null),
 'pid',pg_backend_pid(),'name',current_setting('application_name'));`
  const perform = (sql: string) => sql.startsWith('select ') ? `perform ${sql.slice(7)}` : sql
  const schedules = cases.flatMap((c, index) => (['forward', 'reverse'] as const).map(direction => {
    const first = direction === 'forward' ? c.first : c.second
    const second = direction === 'forward' ? c.second : c.first
    const label = `${c.name}:${direction}`
    // Both response contenders must use the dynamic fixture for this one case.
    const dynamic = index === 14 ? `update public.surveys set dynamic_responses=true where id=${q(f.surveys[0].id)};` : ''
    const holder = `${begin}${dynamic}do $holder$ begin ${perform(first)} end;$holder$;${observe}`
    const contender = `${begin}do $reject$ declare code text;begin
 begin ${perform(second)} raise exception 'Survey contender unexpectedly succeeded';
 exception when sqlstate 'PT409' or sqlstate '55P03' then get stacked diagnostics code=returned_sqlstate;end;
 if code is null then raise exception 'Survey contention evidence missing';end if;
end;$reject$;select jsonb_build_object('rejected',true,'label',${q(label)});`
    return { label, holder, contender, expectedAfterCommit: c.expected }
  }))
  const contracts = freeze({ sql: checked(repository, SURVEY_NATIVE_SOURCES.contracts), kind: 'rollback-sql' as const })
  const concurrency = freeze({ schedules, close: 'rollback;', kind: 'rollback-contention-only' as const })
  for (const sql of [setup, snapshot, contracts.sql, ...schedules.flatMap(row => [row.holder, row.contender])]) assert(Buffer.byteLength(sql) <= SURVEY_NATIVE_CAPS.sqlBytes)
  const plan = freeze({ version: 1, reviewedHead, projectId: f.projectId, fixture, guard, setup, snapshot, contracts, concurrency,
    sourceSha256: SURVEY_NATIVE_SOURCES.migration.sha256,
    migrationManifestSha256: digest(JSON.stringify(migrations.map(({ name, sha256 }) => ({ name, sha256 })))),
    sources: SURVEY_NATIVE_SOURCES, caps: SURVEY_NATIVE_CAPS, sdkProofPreparation: surveySdkProofManifest(fixture), executionEnabled: false as const, nativeVerified: false as const,
    requiredBeforeAcceptance: ['genuine-cli-types263', 'fixed-real-sdk-14-calls', 'committed-two-direction-freshness-and-restoration',
      'exact-backend-and-waiter-observations', 'eight-second-postgrest-cancellation', 'actual-payload-ceilings', 'complete-source-and-global-preservation'],
  })
  sourcePlans.set(plan.contracts, plan)
  return plan
}
export type SurveyNativePlan = ReturnType<typeof surveyNativePlan>

/** Fixed source roots, not target selectors. Root supplies the two independently
 * reviewed Git identities; counted runtime guards verify both before dispatch. */
export const SURVEY_269_COMPONENT_ROOTS = Object.freeze({
  product: '/Users/stew/.codex/worktrees/pika/contextual-surveys-current-main',
  carrier: '/Users/stew/.codex/worktrees/classroom-access-completion-plan/pika',
})
export const SURVEY_269_COMPONENT_SCHEMA = Object.freeze({ count: 269, file: '269_contextual_surveys_workflow.sql',
  prefixSha256: '16dfffc916b245a55e7f6750ff26ae274b5f76b696404c6c9995401b38a1c2e0',
  sourceSha256: '1db152f8c33d239bf18b9fc61bab6da8896f2d9c88fa0fdce12c8671c30770c9',
  manifestSha256: '8f04596017722989202df72acd5cc38f9b705b09b941da4c32d3315070808baf',
})
export const SURVEY_269_SHARED_FILES = Object.freeze(['scripts/contextual-surveys-db-contracts.sql',
  'scripts/contextual-surveys-sdk-contracts.ts', 'src/lib/validations/contextual-surveys.ts'] as const)
export type Survey269ComponentBinding = Readonly<{ product: Readonly<{ head: string; tree: string }>;
  carrier: Readonly<{ head: string; tree: string }>; sharedSources: Readonly<Record<typeof SURVEY_269_SHARED_FILES[number], string>> }>
function componentBinding(raw: Survey269ComponentBinding) {
  for (const value of [raw, raw.product, raw.carrier, raw.sharedSources]) {
    assert(value && Object.getPrototypeOf(value) === Object.prototype)
    assert(Object.values(Object.getOwnPropertyDescriptors(value)).every(field => 'value' in field))
  }
  assert.deepEqual(Object.keys(raw).sort(), ['carrier', 'product', 'sharedSources'])
  for (const source of [raw.product, raw.carrier]) {
    assert.deepEqual(Object.keys(source).sort(), ['head', 'tree']);assert.match(source.head, /^[a-f0-9]{40}$/);assert.match(source.tree, /^[a-f0-9]{40}$/)
  }
  assert.deepEqual(Object.keys(raw.sharedSources).sort(), [...SURVEY_269_SHARED_FILES].sort())
  Object.values(raw.sharedSources).forEach(value => assert.match(value, /^[a-f0-9]{64}$/))
  return freeze(structuredClone(raw))
}
export function verifySurvey269ComponentSources(binding: Survey269ComponentBinding) {
  componentBinding(binding)
  for (const repository of Object.values(SURVEY_269_COMPONENT_ROOTS)) assert.equal(realpathSync(repository), repository)
  for (const file of SURVEY_269_SHARED_FILES) for (const repository of Object.values(SURVEY_269_COMPONENT_ROOTS))
    assert.equal(digest(readFileSync(resolve(repository, file))), binding.sharedSources[file], 'Survey269 shared runtime source differs')
}
export function validateSurvey269ComponentMigrations(migrations: ReturnType<typeof loadAssignmentListReviewedMigrations>) {
  const schema = SURVEY_269_COMPONENT_SCHEMA
  assert.equal(migrations.length, schema.count)
  migrations.forEach((m, index) => {assert(m.name.startsWith(`${String(index + 1).padStart(3, '0')}_`));assert.equal(digest(m.sql), m.sha256)})
  const entries = migrations.map(({ name, sha256 }) => ({ name, sha256 }))
  assert.equal(digest(JSON.stringify(entries.slice(0, 268))), schema.prefixSha256)
  assert.equal(digest(JSON.stringify(entries)), schema.manifestSha256)
  assert.equal(migrations[268].name, schema.file);assert.equal(migrations[268].sha256, schema.sourceSha256)
}
export function survey269ComponentPlan(original: AssignmentListProofFixture, sourceBinding: Survey269ComponentBinding) {
  const binding = componentBinding(sourceBinding);verifySurvey269ComponentSources(binding)
  const migrations = loadAssignmentListReviewedMigrations(SURVEY_269_COMPONENT_ROOTS.product)
  validateSurvey269ComponentMigrations(migrations)
  // Reuse only the closed fixture/setup/rollback/ordinary-SDK source. No race
  // executor or remaining-proof workload is invoked or admitted here.
  const legacy = surveyNativePlan(original, binding.carrier.head, SURVEY_269_COMPONENT_ROOTS.carrier)
  const plan = freeze({ ...legacy, kind: 'survey269-source-compatibility-and-genuine-types' as const, binding,
    reviewedHead: binding.product.head, repository: SURVEY_269_COMPONENT_ROOTS.product,
    migrations: migrations.map(({ name, sha256 }) => ({ name, sha256 })),
    migrationManifestSha256: SURVEY_269_COMPONENT_SCHEMA.manifestSha256,
    sourceSha256: SURVEY_269_COMPONENT_SCHEMA.sourceSha256,
    sources: {...legacy.sources, migration: {file: `supabase/migrations/${SURVEY_269_COMPONENT_SCHEMA.file}`, sha256: SURVEY_269_COMPONENT_SCHEMA.sourceSha256}},
    concurrency: { ...legacy.concurrency, schedules: [] },
    caps: { ...legacy.caps, sdkMs: SURVEY_269_COMPONENT_SDK_CAPS.totalMs },
    sdkProofPreparation: survey269ComponentSdkProofManifest(legacy.fixture),
    inventoryComplete: false as const, nativeVerified: false as const,
    requiredBeforeAcceptance: ['remaining-full-proof-is-separate-and-incomplete'] })
  sourcePlans.set(plan.contracts, plan);return plan
}
export type Survey269ComponentPlan = ReturnType<typeof survey269ComponentPlan>
const componentWorkloads = new WeakSet<object>(), consumedComponents = new WeakSet<object>()
export function bindSurvey269ComponentWorkload(input: { original: AssignmentListProofFixture; binding: Survey269ComponentBinding;
  reviewedManifestSha256: string; absoluteDeadline: number; rootReviewed: true; oneAttemptAuthorized: true; freshCapacityChecked: true }) {
  assert.deepEqual(Object.keys(input).sort(), ['absoluteDeadline','binding','freshCapacityChecked','oneAttemptAuthorized','original','reviewedManifestSha256','rootReviewed'])
  assert.equal(input.rootReviewed, true);assert.equal(input.oneAttemptAuthorized, true);assert.equal(input.freshCapacityChecked, true)
  const plan = survey269ComponentPlan(input.original, input.binding)
  assert.equal(input.reviewedManifestSha256, digest(JSON.stringify(plan)))
  assert(Number.isSafeInteger(input.absoluteDeadline) && input.absoluteDeadline > Date.now() && input.absoluteDeadline <= Date.now() + 900000)
  const workload = freeze({ kind: plan.kind, binding: plan.binding, projectId: plan.projectId,
    reviewedManifestSha256: input.reviewedManifestSha256, absoluteDeadline: input.absoluteDeadline, nativeVerified: false as const })
  componentWorkloads.add(workload);return workload
}
export type Survey269ComponentWorkload = ReturnType<typeof bindSurvey269ComponentWorkload>
export function validateSurvey269ComponentWorkload(workload: Survey269ComponentWorkload, original: AssignmentListProofFixture) {
  assert(componentWorkloads.has(workload) && Object.isFrozen(workload), 'Survey269 workload is not source-bound')
  const plan = survey269ComponentPlan(original, workload.binding)
  assert.equal(workload.kind, plan.kind);assert.equal(workload.projectId, plan.projectId)
  assert.equal(workload.reviewedManifestSha256, digest(JSON.stringify(plan)));return plan
}
export function consumeSurvey269ComponentWorkload(workload: Survey269ComponentWorkload) {
  assert(componentWorkloads.has(workload) && !consumedComponents.has(workload));assert(Date.now() < workload.absoluteDeadline)
  consumedComponents.add(workload)
}
export function validateSurvey269ComponentSql(plan: Survey269ComponentPlan, sql: string) {
  return sealed(plan) && typeof sql === 'string' && Buffer.byteLength(sql) <= SURVEY_NATIVE_CAPS.sqlBytes
    && [plan.setup, plan.snapshot, plan.contracts.sql, plan.concurrency.close].includes(sql)
}
export async function runSurvey269ComponentRollback(plan: Survey269ComponentPlan, target: DraftSaveTarget, driver: DraftSaveDriver) {
  await validateTarget(plan, target, driver, 'contracts')
  const session = await driver.openSession(`${plan.projectId}_draft_contracts`)
  try {await session.execute(plan.contracts.sql, SURVEY_NATIVE_CAPS.actionMs)} finally {await session.rollbackAndClose(SURVEY_NATIVE_CAPS.closeMs)}
  return freeze({ kind: 'survey269-rollback-component-only' as const, nativeVerified: false as const })
}
export function validateSurvey269ComponentGeneratedTypes(source: string, sha256: string) {
  validateSurveyGeneratedTypes(source, sha256)
  const tree = ts.createSourceFile('generated.ts', source, ts.ScriptTarget.Latest, true)
  const field = (node: ts.TypeNode, name: string) => {assert(ts.isTypeLiteralNode(node));const rows = node.members.filter(ts.isPropertySignature).filter(m => m.name.getText(tree) === name);assert.equal(rows.length, 1);assert(rows[0].type && !rows[0].questionToken);return rows[0].type}
  const db = tree.statements.filter(ts.isTypeAliasDeclaration).find(n => n.name.text === 'Database');assert(db)
  const hot = field(field(field(db.type, 'public'), 'Functions'), 'set_classroom_hot_archive_for_owner_v1')
  const args = field(hot, 'Args');assert(ts.isTypeLiteralNode(args))
  assert(args.members.every(m=>ts.isPropertySignature(m) && !m.questionToken))
  assert.deepEqual(args.members.map(m => m.name?.getText(tree)).sort(), ['p_actor_id','p_archived','p_classroom_id'])
  for (const arg of args.members) {assert(ts.isPropertySignature(arg) && !arg.questionToken);assert.equal(arg.type?.kind, arg.name.getText(tree) === 'p_archived' ? ts.SyntaxKind.BooleanKeyword : ts.SyntaxKind.StringKeyword)}
  assert.equal(field(hot, 'Returns').getText(tree), 'Json');return true
}
/** Fixed reviewed leaf; this is an external source pin, not a recomputed approval. */
export const SURVEY_COMMITTED_SOURCE = Object.freeze({ file: 'scripts/contextual-surveys-committed-proof.ts',
  sha256: 'f2f888175d77437b28d25a66bcd8ed109296c77628d82d91db2db1374e286352' })
export function surveyRemainingNativePlan(original: AssignmentListProofFixture, reviewedHead: string, repository: string) {
  const plan = surveyNativePlan(original, reviewedHead, repository)
  checked(repository, SURVEY_COMMITTED_SOURCE)
  const committed = surveyCommittedProofManifest(plan.fixture)
  return freeze({ ...plan, committed, committedSource: SURVEY_COMMITTED_SOURCE,
    kind: 'survey263-remaining-only' as const, inventoryComplete: false as const,
    inventory: { committedActions: committed.inventory.minActions, setupActions: 2, rollbackContractActions: 2,
      sdkSnapshotActions: 4, knownNativeActions: committed.inventory.minActions + 8, remainingNativeActions: 7,
      persistentIdentityBootstrapDispatches: 2, auxiliaryIdentityBootstrapDispatches: 4,
      knownIdentityBootstrapDispatches: 6, persistentSessionSpawns: 2, auxiliarySessionSpawns: 4,
      knownSessionSpawns: 6, knownSessionCloses: 6, sdkRequests: 14,
      committedEngineCommandControls: 1148, completeControls: null,
      committedStaticSqlBytes: committed.inventory.staticSqlBytes,
      completeExchangeBytes: null, engineExchangeByteCap: 64 * 1024 * 1024,
      missing: ['survey-eight-second-postgrest-cancellation', 'actual-survey-payload-ceilings',
        'helper-and-outer-dispatch-accounting', 'restoration-and-final-preservation-inventory',
        'complete-input-output-and-helper-byte-accounting'] } })
}
export function verifySurveyRemainingSources(repository: string) { checked(repository, SURVEY_COMMITTED_SOURCE) }
type SurveyWorkloadData = Readonly<{ kind: 'survey263-rollback-and-sdk-terminal'; repository: string; reviewedHead: string;
  projectId: string; reviewedManifestSha256: string; absoluteDeadline: number; nativeVerified: false }>
const workloads = new WeakSet<object>()
const consumedWorkloads = new WeakSet<object>()
/** Root must explicitly bind this data after fixed-source review. No callbacks,
 * SQL, resource selectors or credentials can be smuggled through this hook. */
export function bindSurveyNativeLifecycleWorkload(input: {
  original: AssignmentListProofFixture; repository: string; reviewedHead: string;
  reviewedManifestSha256: string; absoluteDeadline: number; rootReviewed: true; oneAttemptAuthorized: true; freshCapacityChecked: true;
  remainingOnly?: true;
}) {
  assert.equal(input.rootReviewed, true); assert.equal(input.oneAttemptAuthorized, true); assert.equal(input.freshCapacityChecked, true)
  // Refuse before issuing/consuming a workload or entering resource admission.
  // The private source binding is not complete acceptance inventory.
  if (input.remainingOnly !== undefined) {
    assert.equal(input.remainingOnly, true)
    const remaining = surveyRemainingNativePlan(input.original, input.reviewedHead, input.repository)
    assert(remaining.inventoryComplete, 'Survey remaining-only complete native inventory is absent')
  }
  const plan = surveyNativePlan(input.original, input.reviewedHead, input.repository)
  assert.match(input.reviewedManifestSha256, /^[a-f0-9]{64}$/)
  const now = Date.now()
  assert(Number.isSafeInteger(input.absoluteDeadline) && input.absoluteDeadline > now && input.absoluteDeadline <= now + 900000)
  assert.equal(input.reviewedManifestSha256, digest(JSON.stringify(plan)))
  const workload = freeze({ kind: 'survey263-rollback-and-sdk-terminal' as const, repository: input.repository, reviewedHead: input.reviewedHead,
    projectId: plan.projectId, reviewedManifestSha256: input.reviewedManifestSha256, absoluteDeadline: input.absoluteDeadline, nativeVerified: false as const })
  workloads.add(workload)
  return workload
}
export type SurveyNativeLifecycleWorkload = SurveyWorkloadData
export function validateSurveyNativeLifecycleWorkload(workload: SurveyNativeLifecycleWorkload, original: AssignmentListProofFixture) {
  assert(workloads.has(workload) && Object.isFrozen(workload), 'Survey workload is not source-bound')
  const plan = surveyNativePlan(original, workload.reviewedHead, workload.repository)
  assert.equal(workload.projectId, plan.projectId)
  assert.equal(workload.reviewedManifestSha256, digest(JSON.stringify(plan)))
  assert.equal(workload.kind, 'survey263-rollback-and-sdk-terminal')
  return plan
}
export function consumeSurveyNativeLifecycleWorkload(workload: SurveyNativeLifecycleWorkload) {
  assert(workloads.has(workload) && !consumedWorkloads.has(workload), 'Survey attempt already consumed or unbound')
  assert(Date.now() < workload.absoluteDeadline, 'Survey work deadline expired')
  consumedWorkloads.add(workload)
}
export function validateSurveyNativeSql(plan: SurveyNativePlan, sql: string) {
  return sealed(plan) && typeof sql === 'string' && Buffer.byteLength(sql) <= SURVEY_NATIVE_CAPS.sqlBytes
    && [plan.setup, plan.snapshot, plan.contracts.sql, plan.concurrency.close,
      ...plan.concurrency.schedules.flatMap(row => [row.holder, row.contender])].includes(sql)
}
async function validateTarget(plan: SurveyNativePlan | Survey269ComponentPlan, target: DraftSaveTarget, driver: DraftSaveDriver, phase: 'contracts' | 'concurrency') {
  assert(sealed(plan), 'Survey native plan is not source-sealed')
  assert.equal(target.projectId, plan.projectId)
  assert.equal(target.reviewedHead, plan.reviewedHead)
  assert.equal(target.migrationManifestSha256, plan.migrationManifestSha256)
  assert.equal(target.reviewedSourceSha256, plan.sourceSha256)
  assert.equal(target.acceptedManifestSha256, digest(JSON.stringify(plan[phase])))
  assert.equal(target.disposable, true)
  assert.equal(target.apiUrl, 'http://127.0.0.1:54331'); assert.equal(target.databaseHost, '127.0.0.1'); assert.equal(target.databasePort, 54332)
  assert.equal(target.containerProjectLabel, plan.projectId); assert.match(target.containerId, /^[a-f0-9]{64}$/)
  assert.deepEqual(await driver.verifyTarget(), target)
}
export async function runSurveyNativeRollbackContracts(plan: SurveyNativePlan, target: DraftSaveTarget, driver: DraftSaveDriver) {
  await validateTarget(plan, target, driver, 'contracts')
  const session = await driver.openSession(`${plan.projectId}_draft_contracts`)
  try { await session.execute(plan.contracts.sql, SURVEY_NATIVE_CAPS.actionMs) }
  finally { await session.rollbackAndClose(SURVEY_NATIVE_CAPS.closeMs) }
  return freeze({ kind: 'survey-rollback-sql', nativeVerified: false, sourceSha256: plan.sourceSha256 })
}
export async function runSurveyNativeRollbackRaces(plan: SurveyNativePlan, target: DraftSaveTarget, driver: DraftSaveDriver) {
  await validateTarget(plan, target, driver, 'concurrency')
  const completed: string[] = []
  for (const schedule of plan.concurrency.schedules) {
    let holder: DraftSaveSession | undefined, contender: DraftSaveSession | undefined
    try {
      holder = await driver.openSession(`${plan.projectId}_draft_holder`)
      contender = await driver.openSession(`${plan.projectId}_draft_contender`)
      await validateTarget(plan, target, driver, 'concurrency')
      const rows = await holder.execute(schedule.holder, SURVEY_NATIVE_CAPS.actionMs)
      assert.equal(rows.length, 1)
      const observed = rows[0].result
      assert(observed && typeof observed === 'object' && !Array.isArray(observed))
      const witness = observed as Record<string, unknown>
      assert.deepEqual(Object.keys(witness).sort(), ['held', 'name', 'pid', 'transaction'])
      assert.equal(witness.held, true); assert.equal(witness.transaction, true)
      assert.equal(witness.name, holder.name); assert(Number.isSafeInteger(witness.pid) && Number(witness.pid) > 0)
      assert.deepEqual(await contender.execute(schedule.contender, SURVEY_NATIVE_CAPS.actionMs), [{ result: { rejected: true, label: schedule.label } }])
      completed.push(schedule.label)
    } finally {
      const closed = await Promise.allSettled([holder, contender].filter((s): s is DraftSaveSession => Boolean(s)).map(s => s.rollbackAndClose(SURVEY_NATIVE_CAPS.closeMs)))
      assert(closed.every(result => result.status === 'fulfilled'), 'Survey exact session cleanup unconfirmed')
    }
  }
  assert.equal(completed.length, SURVEY_NATIVE_CAPS.schedules)
  return freeze({ kind: 'survey-rollback-contention-only', schedules: completed, nativeVerified: false,
    limitation: 'No committed freshness, exact waiter graph or SDK/cancellation/payload acceptance is claimed' })
}
