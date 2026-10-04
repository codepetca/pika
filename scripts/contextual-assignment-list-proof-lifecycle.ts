/** Import-safe injected lifecycle. Only root-reviewed adapters perform platform operations. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { assignmentListFixtureSetupSql, type AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import { assignmentListRevocationPlans, type AssignmentListRevocationPlan } from './contextual-assignment-list-proof-revocations'
import { decodeAssignmentListProofManifest, validateAssignmentListProofTarget, type AssignmentListProofManifest } from './check-contextual-assignment-list-reads'

export function validateAssignmentListEphemeralIdentity(input: { projectId: string; workdir: string }) {
  assert.match(input.projectId, /^pika_assignment_list_[a-f0-9]{12}$/)
  const suffix = input.projectId.slice(-12)
  assert(isAbsolute(input.workdir) && input.workdir === `/private/tmp/pika-assignment-list-${suffix}`)
  return { ...input, apiUrl: 'http://127.0.0.1:54331' as const, dbPort: 54332 as const }
}

export function assignmentListCanonicalFingerprintSql() {
  // query_to_xml executes only generated SELECTs; no temp function or DDL is
  // needed in the canonical read-only session. Root may use reviewed239 SQL.
  return `select coalesce(jsonb_object_agg(n.nspname||'.'||c.relname,
query_to_xml(format('select count(*) as count,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'''' order by md5(to_jsonb(r)::text)),'''')) as digest from %I.%I r',n.nspname,c.relname),true,false,'')::text
order by n.nspname,c.relname),'{}'::jsonb)
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where c.relkind in ('r','p') and n.nspname in ('public','private','storage');`
}

export function assignmentListEphemeralPlan(input: { projectId: string; workdir: string }) {
  const identity = validateAssignmentListEphemeralIdentity(input)
  return {
    ...identity, replayOwner: 'root', teardownOwner: 'root', requiredModes: ['normal', 'after-fixture', 'before-capture'],
    // Minimal isolated API+DB+Storage configuration follows the checked-in CI
    // exclusion list; migrations may require Storage tables, but proof fetch
    // containment forbids Storage endpoints and no objects are created.
    config: `project_id = "${identity.projectId}"
[api]
enabled = true
port = 54331
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000
[db]
port = 54332
shadow_port = 54330
major_version = 17
[db.seed]
enabled = false
[studio]
enabled = false
[inbucket]
enabled = false
[realtime]
enabled = false
[storage]
enabled = true
[auth]
site_url = "http://127.0.0.1:54331"
enable_signup = false
`,
    reviewRequirements: [
      'Root records whole public/private/storage row counts+digests, immutable168 guard definition/state, persisted Pal/cleanup settings and scheduler configuration on canonical pika before any isolated operation.',
      'Root proves no containers or named volumes already belong to the freshly allocated project; records exact canonical container and volume IDs. Abort on collision; no adoption of existing resources.',
      'Root creates only the exact empty private/tmp workdir, copies reviewed immutable001239 migration source there, verifies source digests, writes the isolated config, and never copies .env.local or links canonical state.',
      'Root discovers installed CLI help and reviews its exact start/replay command. Checked-in CI uses supabase start -x analytics,edge-runtime,functions,imgproxy,inbucket,meta,realtime,studio,vector; do not assume unknown CLI flags. No canonical reset/push/status retargeting.',
      'Capture exact fresh project-labelled container IDs, Docker network and created named volumes immediately after launch, including ambiguous launch responses. Status must report only54331/54332 and local demo credentials. All writes and fetches bind these exact identities.',
      'Persisted Pal membership/classroom capture and automatic/provider/live student cleanup must be OFF before fixtures. Inspect cron.job; abort if any active scheduler can issue network/provider callbacks. Never change settings or weaken168 guards to make the proof pass.',
      'The fixture transaction is inside try/finally; normal, forced-after-fixture and forced-commit-before-capture all reach exact fresh-project teardown. Generations are intentionally retained inside the throwaway database until its removal.',
      'Before teardown root validates captured container/network/volume identity and project labels, refuses any canonical or preexisting resource, and discovers installed CLI stop semantics. Shutdown/removal uses only exact newly captured resources; no broad globs, volume prune or Storage object deletion.',
      'Finally compare canonical complete row fingerprints,168 guard definition/state, settings and scheduler configuration byte-for-byte, and assert exact ephemeral container/network/volume absence. Any difference or uncertain teardown fails the proof; never claim canonical restoration from a count alone.',
    ],
    unresolved: [
      'The injected orchestrator executes only when explicitly called. Root must independently review and provide actual platform adapters and reserve all ports before execution.',
      'Live member removal cannot reactivate its original168 generation. Restore the relationship using a new preallocated generation and verify original removed/new active identities; fixture-local ledger drift is expected, canonical/nontarget equality remains required.',
      'Owner transfer/archive/visibility/document-return changes can advance fixture revision/timestamp triggers. Exact semantic restoration and explicitly enumerated fixture effects require review; do not claim whole-fixture row equality after those transitions.',
    ],
  }
}

type Identity = ReturnType<typeof validateAssignmentListEphemeralIdentity>
type Plan = ReturnType<typeof assignmentListEphemeralPlan>
type Target = ReturnType<typeof validateAssignmentListProofTarget>
type Mode = 'normal' | 'after-fixture' | 'before-capture'
export type AssignmentListResource = {
  kind: 'container' | 'volume' | 'network'; id: string; name: string; createdAt: string;
  labels: Record<string, string>; attachedIds: string[]; ports: number[];
}
type Inventory = { resources: AssignmentListResource[]; occupiedPorts: number[]; workdirExists: boolean }
type Migration = { name: string; sql: string; sha256: string }
type Cell = { schema: 'public' | 'private'; table: string; id: string; columns: string[] }
type Canonical = { rowDigests: string; guard168Metadata: string; settings: string; cronJobs: string; resources: string }
type Session = { projectId: string; containerId: string; dbPort: 54332; applicationName: string }
type Failure = { stage: string; error: unknown }
export type AssignmentListLifecycleInput = {
  fixture: AssignmentListProofFixture; projectId: string; workdir: string; migrations: Migration[];
  reviewedManifestSha256: string; mode: Mode;
  expectedResources: Pick<AssignmentListResource, 'kind' | 'name'>[];
  restorationPolicies: { transition: AssignmentListRevocationPlan['transition']; boundary: AssignmentListRevocationPlan['boundary']; allowedCells: Cell[] }[];
}
export type AssignmentListLifecycleAdapters = {
  // This hook must include full168 functions/triggers/RLS/ACL/index metadata,
  // full settings and cron rows/command hashes, and canonical resource identities.
  canonicalSnapshot(request: { projectId: 'pika'; dbPort: 54322; applicationName: string; readOnly: true }): Promise<Canonical>;
  // Complete global Docker inventory, including stopped containers and ALL
  // attachment users of volumes/networks. Never project-filter this discovery.
  inventory(identity: Identity): Promise<Inventory>;
  prepare(plan: Plan, migrations: Migration[]): Promise<{ workdir: string; realpath: string; created: boolean; configSha256: string; migrations: Omit<Migration, 'sql'>[]; envFiles: string[]; symlinks: string[] }>;
  command(request: { args: string[]; workdir: string; timeoutMs: number }): Promise<unknown>;
  verifyEphemeral(request: Omit<Session, 'containerId'> & { target: Target }): Promise<Session & { guard168Enabled: boolean; persistedGatesOff: boolean; activeNetworkCronAbsent: boolean }>;
  executeSql(request: Session & { sql: string }): Promise<void>;
  runCase(request: { fixture: AssignmentListProofFixture; proofCase: AssignmentListProofManifest['cases'][number]; target: Target }): Promise<{ actorId: string; classroomId: string; status: '200' | '403' }>;
  runRevocation(request: { fixture: AssignmentListProofFixture; plan: AssignmentListRevocationPlan; target: Target; executeSql: (sql: string) => Promise<void>; verifyRestoration: (plan: AssignmentListRevocationPlan) => Promise<void> }): Promise<{ transition: string; boundary: string; expectedStatus: number }>;
  verifyRestoration(request: { fixture: AssignmentListProofFixture; plan: AssignmentListRevocationPlan; target: Target }): Promise<{ nonTargetBefore: string; nonTargetAfter: string; semanticRestored: boolean; changedCells: Cell[] }>;
  // Reinspect exact IDs, BOTH labels and attachments immediately before removal.
  // stopArgs=null requires exact-ID deletion, NEVER project-wide CLI stop.
  teardown(request: { projectId: string; workdir: string; resources: AssignmentListResource[]; stopArgs: string[] | null }): Promise<void>;
  removeWorkdir(request: { projectId: string; workdir: string; realpath: string }): Promise<void>;
}
export class AssignmentListLifecycleError extends Error {
  constructor(public readonly primary: Failure | undefined, public readonly cleanupFailures: Failure[]) {
    super('Assignment-list isolated lifecycle failed; inspect private stage evidence')
    this.name = 'AssignmentListLifecycleError'
  }
}
const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const resourceKey = (r: Pick<AssignmentListResource, 'kind' | 'name'>) => `${r.kind}:${r.name}`
const isProjectResource = (r: AssignmentListResource, project: string) =>
  r.name.endsWith(`_${project}`) || r.labels['com.supabase.cli.project'] === project || r.labels['com.docker.compose.project'] === project
export function assignmentListExpectedResources(projectId: string): Pick<AssignmentListResource, 'kind' | 'name'>[] {
  assert.match(projectId, /^pika_assignment_list_[a-f0-9]{12}$/)
  return [
    ...['db', 'storage', 'rest', 'auth', 'kong'].map(role => ({ kind: 'container' as const, name: `supabase_${role}_${projectId}` })),
    ...['db', 'storage'].map(role => ({ kind: 'volume' as const, name: `supabase_${role}_${projectId}` })),
    { kind: 'network', name: `supabase_network_${projectId}` },
  ]
}

/** No CLI/DB dispatch at import. All platform authority stays in supplied hooks. */
export async function runAssignmentListEphemeralLifecycle(input: AssignmentListLifecycleInput, adapters: AssignmentListLifecycleAdapters) {
  const identity = validateAssignmentListEphemeralIdentity(input); const plan = assignmentListEphemeralPlan(identity)
  const { fixture, migrations } = input; const manifest = decodeAssignmentListProofManifest(fixture.manifest)
  assert.equal(identity.projectId, `pika_assignment_list_${manifest.syntheticTag.slice(-12)}`)
  assert.equal(sha(JSON.stringify(fixture.manifest)), input.reviewedManifestSha256)
  assert(['normal', 'after-fixture', 'before-capture'].includes(input.mode))
  assert.equal(migrations.length, 239)
  migrations.forEach((m, n) => {
    assert.match(m.name, new RegExp(`^${String(n + 1).padStart(3, '0')}_[a-z0-9_]+\\.sql$`))
    assert.match(m.sha256, /^[a-f0-9]{64}$/); assert.equal(sha(m.sql), m.sha256)
  })
  const expected = new Set(input.expectedResources.map(resourceKey))
  assert.equal(expected.size, input.expectedResources.length)
  for (const r of input.expectedResources) assert.match(r.name, new RegExp(`^supabase_[a-z0-9_-]+_${identity.projectId}$`))
  assert.deepEqual([...expected].sort(), assignmentListExpectedResources(identity.projectId).map(resourceKey).sort())
  const revocations = assignmentListRevocationPlans(fixture)
  assert.equal(input.restorationPolicies.length, revocations.length)
  const policyKeys = new Set(input.restorationPolicies.map(p => `${p.transition}:${p.boundary}`)); assert.equal(policyKeys.size, revocations.length)
  for (const p of revocations) assert(policyKeys.has(`${p.transition}:${p.boundary}`))
  for (const p of input.restorationPolicies) for (const cell of p.allowedCells) {
    assert(['public', 'private'].includes(cell.schema))
    assert(['classrooms', 'classroom_archive_revisions', 'assignment_docs', 'classroom_enrollments', 'pal_membership_generations'].includes(cell.table))
    assert(fixture.allocatedIds.some(id => id === cell.id)); assert(cell.columns.length > 0 && cell.columns.every(c => c === '__row__' || /^[a-z][a-z0-9_]*$/.test(c)))
    const transition = revocations.find(r => r.transition === p.transition && r.boundary === p.boundary)!
    if (cell.table === 'classrooms' || cell.table === 'classroom_archive_revisions') assert(cell.schema === 'public' && cell.id === transition.classroomId)
    else if (cell.table === 'assignment_docs') assert(cell.schema === 'public' && ['grade-withdraw', 'feedback-withdraw'].includes(p.transition) && cell.id === fixture.docs.find(d => d.returned)!.id)
    else {
      assert.equal(p.transition, 'member-remove')
      assert.equal(cell.schema, cell.table === 'pal_membership_generations' ? 'private' : 'public')
      const index = ['first', 'later', 'terminal'].indexOf(p.boundary)
      const old = index === 0 ? fixture.enrollments.find(e => e.classroom === transition.classroomId && e.student === transition.actorId)!.id : fixture.replacementEnrollments[index - 1].id
      assert([old, fixture.replacementEnrollments[index].id].some(id => id === cell.id))
    }
  }
  const canonicalRequest = { projectId: 'pika' as const, dbPort: 54322 as const, applicationName: `${identity.projectId}_canonical_readonly`, readOnly: true as const }
  let baseline: Canonical | undefined; let before: Inventory | undefined; let target: Target | undefined
  let prepared: Awaited<ReturnType<AssignmentListLifecycleAdapters['prepare']>> | undefined
  let prepareAttempted = false; let startAttempted = false; let stage = 'canonical-before'; let primary: Failure | undefined
  const cleanupFailures: Failure[] = []; const captured = new Map<string, AssignmentListResource>()
  const validateCanonical = (snapshot: Canonical) => { for (const k of ['rowDigests', 'guard168Metadata', 'settings', 'cronJobs', 'resources'] as const) assert(typeof snapshot[k] === 'string' && snapshot[k].length > 0) }
  const inspectFresh = async () => {
    assert(before)
    const current = await adapters.inventory(identity)
    assert.equal(new Set(current.resources.map(r => r.id)).size, current.resources.length)
    const selected = current.resources.filter(r => isProjectResource(r, identity.projectId)); const ids = new Set(selected.map(r => r.id))
    assert.equal(new Set(selected.map(resourceKey)).size, selected.length)
    assert(!current.resources.some(r => !ids.has(r.id) && r.attachedIds.some(id => ids.has(id))))
    for (const r of selected) {
      assert(!before.resources.some(old => old.id === r.id || (old.kind === r.kind && old.name === r.name)))
      assert.equal(r.labels['com.supabase.cli.project'], identity.projectId); assert.equal(r.labels['com.docker.compose.project'], identity.projectId)
      assert(expected.has(resourceKey(r))); assert(r.createdAt.length > 0 && r.attachedIds.every(id => ids.has(id)))
      assert(r.ports.every(port => [54330, 54331, 54332].includes(port)))
      const old = captured.get(r.id); if (old) { assert.equal(resourceKey(old), resourceKey(r)); assert.equal(old.createdAt, r.createdAt) }
    }
    return { current, selected }
  }
  const capture = async () => {
    const result = await inspectFresh()
    // Validate the complete closure before recording any deletion authority.
    for (const r of result.selected) captured.set(r.id, structuredClone(r))
    return result
  }
  const session = async (): Promise<Session> => {
    assert(target && before)
    const { selected } = await inspectFresh(); assert.equal(selected.length, expected.size)
    const db = selected.find(r => r.kind === 'container' && r.name === `supabase_db_${identity.projectId}`)!
    const kong = selected.find(r => r.kind === 'container' && r.name === `supabase_kong_${identity.projectId}`)!
    assert.deepEqual(db.ports, [54332]); assert.deepEqual(kong.ports, [54331])
    const s = await adapters.verifyEphemeral({ projectId: identity.projectId, dbPort: 54332, applicationName: `${identity.projectId}_fixture`, target })
    assert.equal(s.projectId, identity.projectId); assert.equal(s.dbPort, 54332); assert.equal(s.applicationName, `${identity.projectId}_fixture`)
    assert.equal(s.containerId, db.id); assert(s.guard168Enabled && s.persistedGatesOff && s.activeNetworkCronAbsent)
    return { projectId: s.projectId, containerId: s.containerId, dbPort: s.dbPort, applicationName: s.applicationName }
  }
  const approvedSql = new Set([assignmentListFixtureSetupSql(fixture, identity.projectId), ...revocations.flatMap(p => [p.revokeSql, p.restoreSql])])
  const executeSql = async (sql: string) => { assert(approvedSql.has(sql)); await adapters.executeSql({ ...await session(), sql }) }
  try {
    baseline = structuredClone(await adapters.canonicalSnapshot(canonicalRequest)); validateCanonical(baseline)
    stage = 'preflight'; before = structuredClone(await adapters.inventory(identity))
    assert(!before.workdirExists && !before.occupiedPorts.some(port => [54330, 54331, 54332].includes(port)))
    assert(!before.resources.some(r => isProjectResource(r, identity.projectId)))
    stage = 'prepare'; prepareAttempted = true; prepared = await adapters.prepare(plan, migrations)
    assert(prepared.created); assert.equal(prepared.workdir, identity.workdir); assert.equal(prepared.realpath, identity.workdir)
    assert.equal(prepared.configSha256, sha(plan.config)); assert.deepEqual(prepared.migrations, migrations.map(({ name, sha256 }) => ({ name, sha256 })))
    assert.deepEqual(prepared.envFiles, []); assert.deepEqual(prepared.symlinks, [])
    // Recheck global resources and port ownership immediately before launching.
    stage = 'pre-start'; const fresh = await adapters.inventory(identity)
    assert(!fresh.occupiedPorts.some(port => [54330, 54331, 54332].includes(port))); assert(!fresh.resources.some(r => isProjectResource(r, identity.projectId)))
    before.resources = structuredClone(fresh.resources)
    stage = 'start'; startAttempted = true
    await adapters.command({ args: ['start', '--workdir', identity.workdir, '-x', 'analytics,edge-runtime,functions,imgproxy,inbucket,meta,realtime,studio,vector'], workdir: identity.workdir, timeoutMs: 180000 })
    if (input.mode !== 'before-capture') { stage = 'capture'; await capture() }
    stage = 'status'; target = validateAssignmentListProofTarget(await adapters.command({ args: ['status', '--workdir', identity.workdir, '-o', 'json'], workdir: identity.workdir, timeoutMs: 15000 }), identity.projectId)
    stage = 'fixture'; await executeSql(assignmentListFixtureSetupSql(fixture, identity.projectId))
    if (input.mode !== 'normal') { stage = input.mode; throw new Error('Forced isolated lifecycle failure') }
    stage = 'cases'
    for (const proofCase of manifest.cases) {
      await session(); const result = await adapters.runCase({ fixture, proofCase, target })
      assert.deepEqual(result, { actorId: proofCase.actorId, classroomId: proofCase.classroomId, status: proofCase.expectedStatus })
    }
    stage = 'revocations'
    for (const p of revocations) {
      const policy = input.restorationPolicies.find(x => x.transition === p.transition && x.boundary === p.boundary)!
      let restored = false
      const verifyRestoration = async (received: AssignmentListRevocationPlan) => {
        assert.deepEqual(received, p); const evidence = await adapters.verifyRestoration({ fixture, plan: p, target: target! })
        assert(evidence.semanticRestored && evidence.nonTargetBefore.length > 0); assert.equal(evidence.nonTargetBefore, evidence.nonTargetAfter)
        for (const change of evidence.changedCells) {
          const allow = policy.allowedCells.find(c => c.schema === change.schema && c.table === change.table && c.id === change.id)
          assert(allow && change.columns.length > 0 && change.columns.every(c => allow.columns.includes(c)))
        }
        restored = true
      }
      const scopedSql = async (sql: string) => { assert(sql === p.revokeSql || sql === p.restoreSql); await executeSql(sql) }
      await session(); const result = await adapters.runRevocation({ fixture, plan: p, target, executeSql: scopedSql, verifyRestoration })
      assert(restored); assert.deepEqual(result, { transition: p.transition, boundary: p.boundary, expectedStatus: p.expectedStatus })
    }
  } catch (error) { primary = { stage, error } }
  finally {
    const check = async (at: string, action: () => Promise<void>) => { try { await action() } catch (error) { cleanupFailures.push({ stage: at, error }) } }
    let closure: AssignmentListResource[] | undefined; let absent = !startAttempted
    if (startAttempted) {
      // Always discover in finally: handles unknown launch outcomes and committed
      // fixture failure before the normal capture checkpoint.
      await check('capture', async () => { await capture(); closure = (await capture()).selected })
      if (closure?.length) await check('teardown', async () => {
        const complete = closure!.length === expected.size && closure!.every(r => expected.has(resourceKey(r)))
        await adapters.teardown({ projectId: identity.projectId, workdir: identity.workdir, resources: structuredClone(closure!), stopArgs: complete ? ['stop', '--project-id', identity.projectId, '--no-backup'] : null })
      })
      await check('absence', async () => {
        const current = await adapters.inventory(identity)
        assert(!current.resources.some(r => captured.has(r.id) || isProjectResource(r, identity.projectId)))
        assert(!current.occupiedPorts.some(port => [54330, 54331, 54332].includes(port))); absent = true
      })
    }
    if (prepareAttempted) await check('workdir', async () => {
      assert(prepared?.created && prepared.realpath === identity.workdir && absent)
      await adapters.removeWorkdir({ projectId: identity.projectId, workdir: identity.workdir, realpath: prepared.realpath })
      assert(!(await adapters.inventory(identity)).workdirExists)
    })
    if (baseline) await check('canonical-after', async () => { const after = await adapters.canonicalSnapshot(canonicalRequest); validateCanonical(after); assert.deepEqual(after, baseline) })
  }
  if (primary || cleanupFailures.length) throw new AssignmentListLifecycleError(primary, cleanupFailures)
  return { projectId: identity.projectId, mode: input.mode, cases: manifest.cases.length, revocations: revocations.length }
}
