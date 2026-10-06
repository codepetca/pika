/** Inert import. Generate a private artifact from one reviewed disposable schema;
 * never write generated source, target the canonical database or load env files.
 * CLI owns its temporary pg-meta container; fresh closure must match afterward. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { assignmentListProofWorkdir } from './contextual-assignment-list-proof-path'
import { loadAssignmentListReviewedMigrations } from './contextual-assignment-list-proof-platform'
import { assignmentListEphemeralPlan } from './contextual-assignment-list-proof-lifecycle'
import { testOwnerListDockerInventory } from './contextual-test-owner-list-proof-inventory'

const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const MAX_BYTES = 8 * 1024 * 1024
type Run = (file: string, args: readonly string[]) => Promise<string>

async function command(file: string, args: readonly string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(file, [...args], { timeout: 60000, maxBuffer: MAX_BYTES, encoding: 'utf8' },
      (error, stdout) => error ? reject(new Error('Private isolated type-generation command failed')) : resolve(stdout))
  })
}

export function testDraftSaveTypeGenerationPlan(repository: string, reviewedHead: string, projectId: string) {
  assert.match(reviewedHead, /^[a-f0-9]{40}$/)
  assert.match(projectId, /^pika_assignment_list_[a-f0-9]{12}$/)
  assert.equal(realpathSync(repository), repository)
  const workdir = assignmentListProofWorkdir(projectId)
  assert.equal(realpathSync(workdir), workdir)
  const migrations = loadAssignmentListReviewedMigrations(repository)
  assert(migrations.length >= 249, 'Complete schema must include the 001–249 baseline')
  for (const migration of migrations) {
    assert.equal(sha(readFileSync(join(workdir, 'supabase/migrations', migration.name), 'utf8')), migration.sha256)
  }
  const config = readFileSync(join(workdir, 'supabase/config.toml'), 'utf8')
  assert.equal(config, assignmentListEphemeralPlan({ projectId, workdir }).config)
  return Object.freeze({ repository, reviewedHead, projectId, workdir,
    migrationManifestSha256: sha(JSON.stringify(migrations.map(({ name, sha256 }) => ({ name, sha256 })))),
    configSha256: sha(config),
    args: Object.freeze(['gen', 'types', 'typescript', '--local', '--schema', 'public', '--query-timeout', '15s', '--workdir', workdir]),
    outputPath: join(dirname(workdir), `pika-test-draft-save-generated-${reviewedHead}.ts`) })
}

/** A frozen runtime source acceptance includes this exact command and artifact.
 * Caller supplies the original full-resource/private-control guard, not a bypass.
 * No artifact is accepted if CLI resources remain or canonical closure changes. */
export async function generateTestDraftSaveTypes(input: {
  repository: string; reviewedHead: string; projectId: string;
  guard: () => Promise<void>;
}, run: Run = command, inventory = testOwnerListDockerInventory) {
  const plan = testDraftSaveTypeGenerationPlan(input.repository, input.reviewedHead, input.projectId)
  const verifySource = async () => {
    assert.equal((await run('git', ['-C', plan.repository, 'rev-parse', 'HEAD'])).trim(), plan.reviewedHead)
    assert.equal((await run('git', ['-C', plan.repository, 'status', '--porcelain', '--untracked-files=all'])).trim(), '')
    assert.deepEqual(testDraftSaveTypeGenerationPlan(plan.repository, plan.reviewedHead, plan.projectId), plan)
    await input.guard()
  }
  await verifySource()
  const before = await inventory()
  const db = before.filter(row => row.kind === 'container' && row.name === `supabase_db_${plan.projectId}`)
  assert.equal(db.length, 1)
  assert.equal(db[0].labels['com.supabase.cli.project'], plan.projectId)
  assert.equal(db[0].labels['com.docker.compose.project'], plan.projectId)
  assert.deepEqual(db[0].ports, [54332])
  let stdout: string | undefined
  let failure: unknown
  try { stdout = await run('supabase', plan.args) } catch (error) { failure = error }
  // Always verify CLI's temporary resource settlement, including command failure.
  const after = await inventory()
  assert.deepEqual(after, before, 'Type-generator resource closure differs; no artifact accepted')
  await verifySource()
  if (failure) throw failure
  assert(typeof stdout === 'string' && Buffer.byteLength(stdout) <= MAX_BYTES)
  assert(stdout.includes('snapshot_test_draft_save_for_owner_v1:'))
  assert(stdout.includes('finish_test_draft_save_for_owner_v1:'))
  assert(stdout.includes('export type Database ='))
  // Match the canonical generator's removal of trailing blank lines.
  const artifact = stdout.trimEnd() + '\n'
  writeFileSync(plan.outputPath, artifact, { mode: 0o600, flag: 'wx' })
  return Object.freeze({ path: plan.outputPath, sha256: sha(artifact), bytes: Buffer.byteLength(artifact),
    reviewedHead: plan.reviewedHead, migrationManifestSha256: plan.migrationManifestSha256, configSha256: plan.configSha256 })
}
