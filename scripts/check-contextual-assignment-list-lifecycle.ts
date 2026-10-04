/** Execute only after independent fixed-source review. No operations at import. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { assignmentListProofWorkdir } from './contextual-assignment-list-proof-path'
import { newAssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import { assignmentListRevocationPlans } from './contextual-assignment-list-proof-revocations'
import { runAssignmentListEphemeralLifecycle, AssignmentListLifecycleError, assignmentListLifecycleDiagnostic } from './contextual-assignment-list-proof-lifecycle'
import { AssignmentListStartupError, assignmentListExpectedResources, assignmentListRestorationPolicy, createAssignmentListNativeAdapters, loadAssignmentListReviewedMigrations } from './contextual-assignment-list-proof-platform'

export function parseAssignmentListLifecycleArgs(args: string[]): { head: string; mode: 'normal' | 'after-fixture' | 'before-capture' } {
  assert.equal(args.length, 4); assert.equal(args[0], '--reviewed-head'); assert.match(args[1], /^[a-f0-9]{40}$/)
  assert.equal(args[2], '--mode'); assert(args[3] === 'normal' || args[3] === 'after-fixture' || args[3] === 'before-capture')
  return { head: args[1], mode: args[3] }
}
export async function assignmentListLifecycleMain(args = process.argv.slice(2)) {
  const input = parseAssignmentListLifecycleArgs(args)
  const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).trim()
  assert.equal(git(['rev-parse', 'HEAD']), input.head)
  assert.equal(git(['status', '--porcelain']), '')
  const repository = git(['rev-parse', '--show-toplevel'])
  assert.equal(repository, process.cwd())
  const fixture = newAssignmentListProofFixture()
  const projectId = `pika_assignment_list_${fixture.manifest.syntheticTag.slice(-12)}`
  const mode = input.mode
  try {
    await runAssignmentListEphemeralLifecycle({ fixture, projectId, workdir: assignmentListProofWorkdir(projectId),
      migrations: loadAssignmentListReviewedMigrations(repository), mode,
      expectedResources: assignmentListExpectedResources(projectId),
      reviewedManifestSha256: createHash('sha256').update(JSON.stringify(fixture.manifest)).digest('hex'),
      restorationPolicies: assignmentListRevocationPlans(fixture).map(plan => assignmentListRestorationPolicy(fixture, plan)),
    }, createAssignmentListNativeAdapters(fixture))
    process.stdout.write('PASS isolated assignment-list nine SDK cases and fourteen revocations.\nPASS isolated assignment-list exact teardown and unchanged canonical baseline.\n')
  } catch (error) {
    if (error instanceof AssignmentListLifecycleError && error.primary?.stage === 'start' && error.primary.error instanceof AssignmentListStartupError) process.stderr.write(`DIAG private startup receipt: ${error.primary.error.diagnosticPath}\n`)
    if (mode !== 'normal' && error instanceof AssignmentListLifecycleError && error.primary?.stage === mode
      && error.primary.error instanceof Error && error.primary.error.message === 'Forced isolated lifecycle failure' && error.cleanupFailures.length === 0) {
      process.stdout.write('PASS isolated assignment-list exact teardown and unchanged canonical baseline.\n')
      process.stderr.write(`FAIL forced isolated assignment-list lifecycle: ${mode}.\n`); process.exitCode = 1; return
    }
    if (error instanceof AssignmentListLifecycleError) process.stderr.write(`DIAG isolated assignment-list stage=${error.primary?.stage ?? 'cleanup'} cleanup=${error.cleanupFailures.map(failure => failure.stage).join(',') || 'none'}.\n`)
    if (error instanceof AssignmentListLifecycleError && error.primary?.stage === 'revocations') process.stderr.write(`DIAG isolated assignment-list ${assignmentListLifecycleDiagnostic(error.primary)}.\n`)
    throw new Error('Isolated assignment-list lifecycle failed; private details withheld')
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) assignmentListLifecycleMain().catch(() => {
  process.stderr.write('FAIL isolated assignment-list lifecycle; detailed output withheld.\n'); process.exitCode = 1
})
