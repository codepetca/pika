import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { extractWorkflow } from '../../scripts/run-ci-local.mjs'

const workflowPath = resolve(process.cwd(), '.github/workflows/ci.yml')
const retiredUiWorkflowPath = resolve(process.cwd(), '.github/workflows/ui-policy.yml')

const ownerProfiles = [
  ['detail', 'Verify isolated contextual Test owner-detail SDK reads'],
  ['list', 'Verify isolated contextual Test owner-list SDK reads'],
  ['draft-get', 'Verify isolated contextual Test owner-draft GET transactions'],
  ['draft-save', 'Verify isolated contextual Test owner-draft save transactions'],
  ['create', 'Verify isolated contextual Test owner creation transactions'],
  ['pristine-discard', 'Verify isolated contextual pristine Test draft discard transactions'],
  ['publication', 'Verify isolated contextual Test owner publication transactions'],
] as const

function jobSource(workflow: string, id: string) {
  return workflow.split(`  ${id}:\n`)[1]?.split(/\n  [a-z][a-z-]*:\n/)[0] ?? ''
}

function runGate(overrides: Record<string, string | undefined> = {}) {
  const gate = jobSource(readFileSync(workflowPath, 'utf8'), 'pr-gate')
  const script = gate.split('        run: |\n')[1].split('\n').map(line => line.slice(10)).join('\n')
  return spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, CI_EVENT_ELIGIBLE: 'true', CLASSIFY_RESULT: 'success',
      TEST_BUILD_RESULT: 'success', TEST_BUILD_REQUIRED: 'true', DATABASE_REQUIRED: 'true',
      DATABASE_RESULT: 'success', DATABASE_LIFECYCLE_RESULT: 'success', TEST_OWNER_SDK_RESULT: 'success', TEST_OWNER_SDK_LIFECYCLE_RESULT: 'success', BROWSER_REQUIRED: 'false',
      BROWSER_RESULT: 'skipped', BROWSER_DARK_RESULT: 'skipped', BROWSER_PATTERN_DARK_RESULT: 'skipped', CI_MODE: 'application-database', ...overrides },
  })
}

describe('CI workflow', () => {
  it('partitions every database proof at the owner reorder boundary with independent setup', () => {
    const source = readFileSync(workflowPath, 'utf8')
    const jobs = extractWorkflow(source)
    const primary = jobs['architecture-database-contracts'], secondary = jobs['architecture-database-contracts-lifecycle']
    const proofs = (job: typeof primary) => job.steps.slice(job.steps.findIndex(step => step.id === 'supabase-start') + 1,
      job.steps.findIndex(step => step.run === 'supabase stop --no-backup'))
    expect(proofs(primary)).toHaveLength(53)
    expect(proofs(secondary)).toHaveLength(85)
    expect(proofs(primary).filter(step => step.name === 'Verify contextual Test owner workflow database contracts')).toHaveLength(1)
    expect(proofs(primary).filter(step => step.name === 'Verify contextual Test learner workflow authority and lifecycle')).toHaveLength(1)
    expect(proofs(primary).filter(step => step.name === 'Verify contextual Test owner inspection, manual grading and return')).toHaveLength(1)
    expect(proofs(primary).at(-1)?.name).toBe('Verify isolated contextual Test member-list SDK reads')
    expect(proofs(secondary)[0].name).toBe('Verify isolated contextual Test owner reorder transactions')
    expect(new Set([...proofs(primary), ...proofs(secondary)].map(step => step.name)).size).toBe(138)
    for (const job of [primary, secondary]) {
      expect(proofs(job).every(step => step.run && !step.if && !step.uses)).toBe(true)
      expect(job.steps.find(step => step.uses === 'supabase/setup-cli@v1')?.with.version).toBe('2.103.0')
      expect(job.steps.find(step => step.uses === 'actions/setup-node@v6')?.with['node-version']).toBe("'24'")
      expect(job.steps.find(step => step.uses === 'pnpm/action-setup@v6')?.with.version).toBe('10.25.0')
      expect(job.steps.find(step => step.name === 'Install dependencies')?.run).toBe('pnpm install --frozen-lockfile')
      expect(job.steps.find(step => step.name === 'Verify managed-storage migration lineage')?.run).toBe('pnpm run check:managed-storage-lineage')
      expect(job.steps.find(step => step.id === 'ci-isolation')?.run).toBe(`node scripts/ci-runner-preflight.mjs --lane ${job.lane}`)
    }
    expect(jobSource(source, secondary.id)).toContain('runs-on: ubuntu-latest')
    expect(jobSource(source, secondary.id)).toContain("if: needs.classify-changes.outputs.run_database == 'true'")
    expect(jobSource(source, secondary.id)).toContain('needs: classify-changes')
    expect(jobSource(source, 'pr-gate')).toContain('DATABASE_LIFECYCLE_RESULT: ${{ needs.architecture-database-contracts-lifecycle.result }}')
  })

  it.each(['DATABASE_RESULT', 'DATABASE_LIFECYCLE_RESULT'].flatMap(key =>
    ['failure', 'cancelled', 'skipped', '', undefined].flatMap(result =>
      ['application-database', 'application-database-browser', 'full'].map(mode => [key, result, mode] as const))))(
    'rejects required %s=%s in %s using the actual Bash gate', (key, result, mode) => {
      expect(runGate({ CI_MODE: mode, BROWSER_REQUIRED: mode === 'application-database' ? 'false' : 'true',
        BROWSER_RESULT: 'success', BROWSER_DARK_RESULT: 'success', BROWSER_PATTERN_DARK_RESULT: 'success', [key]: result }).status).toBe(1)
    })

  it.each(['docs-only', 'production-promotion', 'application-test-build', 'application-browser'])(
    'permits both database jobs to be skipped in %s', mode => {
      expect(runGate({ CI_MODE: mode, TEST_BUILD_REQUIRED: mode === 'docs-only' ? 'false' : 'true',
        DATABASE_REQUIRED: 'false', DATABASE_RESULT: 'skipped', DATABASE_LIFECYCLE_RESULT: 'skipped',
        TEST_OWNER_SDK_RESULT: 'skipped', TEST_OWNER_SDK_LIFECYCLE_RESULT: 'skipped',
        BROWSER_REQUIRED: mode === 'application-browser' ? 'true' : 'false', BROWSER_RESULT: 'success', BROWSER_DARK_RESULT: 'success', BROWSER_PATTERN_DARK_RESULT: 'success' }).status).toBe(0)
    })

  it('partitions all seven established owner profiles into two isolated database-selected jobs', () => {
    const workflow = readFileSync(workflowPath, 'utf8')
    const jobs = extractWorkflow(workflow)
    const shard = jobs['contextual-test-owner-sdk']
    const lifecycle = jobs['contextual-test-owner-sdk-lifecycle']
    const database = jobs['architecture-database-contracts']
    const primaryProfiles = new Set(['detail', 'list', 'draft-save', 'create'])
    for (const job of [shard, lifecycle]) {
      const body = jobSource(workflow, job.id)
      expect(body).toContain('needs: classify-changes\n')
      expect(body).toContain("if: needs.classify-changes.outputs.run_database == 'true'")
      expect(body).toContain('runs-on: ubuntu-latest')
      expect(body).not.toContain('heavy_runner')
      expect(job.steps.filter(step => step.run?.includes('--reviewed-head')).map(step => step.name))
        .toEqual(ownerProfiles.filter(([profile]) => primaryProfiles.has(profile) === (job === shard)).map(([, name]) => name))
      expect(job.steps.find(step => step.uses === 'supabase/setup-cli@v1')?.with.version).toBe('2.103.0')
      expect(job.steps.find(step => step.uses === 'actions/setup-node@v6')?.with['node-version']).toBe("'24'")
      expect(job.steps.find(step => step.uses === 'pnpm/action-setup@v6')?.with.version).toBe('10.25.0')
      expect(job.steps.find(step => step.name === 'Install dependencies')?.run).toBe('pnpm install --frozen-lockfile')
      expect(job.steps.find(step => step.name === 'Verify managed-storage migration lineage')?.run).toBe('pnpm run check:managed-storage-lineage')
      expect(job.steps.filter(step => step.id === 'supabase-start')).toHaveLength(1)
      expect(job.steps.filter(step => step.run === 'supabase stop --no-backup')).toHaveLength(1)
    }
    expect(lifecycle.steps.some(step => step.uses === 'actions/upload-artifact@v7')).toBe(false)
    for (const [profile, name] of ownerProfiles) {
      expect(workflow.split(`      - name: ${name}\n`)).toHaveLength(2)
      expect(database.steps.some(step => step.name === name)).toBe(false)
      const job = primaryProfiles.has(profile) ? shard : lifecycle
      const step = job.steps.find(step => step.name === name)!
      expect(job.steps.indexOf(step)).toBeGreaterThan(job.steps.findIndex(step => step.id === 'supabase-start'))
      expect(job.steps.indexOf(step)).toBeLessThan(job.steps.findIndex(step => step.run === 'supabase stop --no-backup'))
      const variable = `test_owner_${profile.replaceAll('-', '_')}`
      expect(step.run).toContain(`${variable}_head=$(git rev-parse HEAD)`)
      expect(step.run).toContain(`pnpm exec tsx scripts/check-contextual-test-owner-${profile}-lifecycle.ts --reviewed-head "$${variable}_head" --mode normal`)
      expect(step.run).toContain(`for ${variable}_mode in after-fixture before-capture; do`)
      expect(step.run).toContain(`--mode "$${variable}_mode"`)
      expect(step.run).toContain(`[[ "$${variable}_status" -eq 1 ]] || exit 1`)
      expect(step.run).toContain(`[[ "$(wc -l < "$${variable}_log" | tr -d ' ')" -eq 2 ]] || exit 1`)
      expect(step.run).toContain(`grep -Fx "FAIL forced isolated test-owner-${profile} lifecycle: \${${variable}_mode}."`)
      expect(step.run).toContain(`grep -Fx 'PASS isolated test-owner-${profile} exact teardown and unchanged canonical baseline.'`)
      expect(step.if).toBeUndefined()
      expect(step.run).not.toMatch(/continue-on-error|wait |tee |\s&\s/)
    }
    for (const name of ['Verify isolated contextual Test member-list SDK reads', 'Verify isolated contextual Test owner reorder transactions']) {
      expect([database, jobs['architecture-database-contracts-lifecycle']].flatMap(job => job.steps).filter(step => step.name === name)).toHaveLength(1)
      for (const job of [shard, lifecycle]) expect(job.steps.some(step => step.name === name)).toBe(false)
    }
    const upload = shard.steps.find(step => step.name === 'Upload sanitized Test proof timings')!
    expect(database.steps.some(step => step.name === upload.name)).toBe(false)
    expect(workflow.split('      - name: Upload sanitized Test proof timings\n')).toHaveLength(2)
    expect(shard.steps.indexOf(upload)).toBeGreaterThan(shard.steps.findIndex(step => step.run === 'supabase stop --no-backup'))
    const gate = jobSource(workflow, 'pr-gate')
    for (const dependency of ['classify-changes', 'architecture-database-contracts', 'architecture-database-contracts-lifecycle', 'contextual-test-owner-sdk', 'contextual-test-owner-sdk-lifecycle', 'test-and-build', 'browser-experience-matrix', 'browser-experience-dark', 'browser-pattern-lab-dark']) {
      expect(gate).toContain(`      - ${dependency}\n`)
    }
    expect(gate).toContain('TEST_OWNER_SDK_RESULT: ${{ needs.contextual-test-owner-sdk.result }}')
    expect(gate).toContain('TEST_OWNER_SDK_LIFECYCLE_RESULT: ${{ needs.contextual-test-owner-sdk-lifecycle.result }}')
    expect(gate).toContain('DATABASE_REQUIRED: ${{ needs.classify-changes.outputs.run_database }}')
  })

  it.each(['failure', 'cancelled', 'skipped', ''])('rejects a selected SDK shard ending %s in the actual aggregate gate', result => {
    const gate = runGate({ TEST_OWNER_SDK_RESULT: result })
    expect(gate.status).toBe(1)
    expect(gate.stdout).toContain('Contextual Test Owner SDK was required but ended:')
  })

  it.each(['failure', 'cancelled', 'skipped', '', undefined])('rejects a selected SDK lifecycle partition ending %s in the actual aggregate gate', result => {
    const gate = runGate({ TEST_OWNER_SDK_LIFECYCLE_RESULT: result })
    expect(gate.status).toBe(1)
    expect(gate.stdout).toContain('Contextual Test Owner SDK Lifecycle was required but ended:')
  })

  it.each(['failure', 'cancelled', 'skipped', '', undefined])('rejects a selected dark browser partition ending %s in the actual gate', result => {
    const gate = runGate({ CI_MODE: 'application-browser', DATABASE_REQUIRED: 'false', BROWSER_REQUIRED: 'true',
      BROWSER_RESULT: 'success', BROWSER_DARK_RESULT: result, BROWSER_PATTERN_DARK_RESULT: 'success' })
    expect(gate.status).toBe(1)
    expect(gate.stdout).toContain('Browser Experience Matrix Dark was required but ended:')
  })

  it.each(['failure', 'cancelled', 'skipped', '', undefined].flatMap(result =>
    ['application-browser', 'application-database-browser', 'full'].map(mode => [result, mode] as const)))(
    'rejects dark Pattern Lab result=%s in %s using the actual Bash gate', (result, mode) => {
      const gate = runGate({ CI_MODE: mode, DATABASE_REQUIRED: mode === 'application-browser' ? 'false' : 'true',
        BROWSER_REQUIRED: 'true', BROWSER_RESULT: 'success', BROWSER_DARK_RESULT: 'success', BROWSER_PATTERN_DARK_RESULT: result })
      expect(gate.status).toBe(1)
      expect(gate.stdout).toContain('Browser Pattern Lab Dark was required but ended:')
    })

  it.each(['skipped', 'failure', 'cancelled', '', undefined].flatMap(result =>
    ['docs-only', 'production-promotion', 'application-test-build', 'application-database'].map(mode => [result, mode] as const)))(
    'allows unselected dark Pattern Lab result=%s in %s', (result, mode) => {
      expect(runGate({ CI_MODE: mode, TEST_BUILD_REQUIRED: mode === 'docs-only' ? 'false' : 'true',
        DATABASE_REQUIRED: mode === 'application-database' ? 'true' : 'false', BROWSER_PATTERN_DARK_RESULT: result }).status).toBe(0)
    })

  it('preserves the full configured browser inventory with only independent auth setup repeated', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }
    const jobs = extractWorkflow(readFileSync(workflowPath, 'utf8'))
    const commands = ['browser-experience-matrix', 'browser-experience-dark', 'browser-pattern-lab-dark'].map(id => {
      const runs = jobs[id].steps.filter(step => step.run?.startsWith('pnpm e2e:ci'))
      expect(runs).toHaveLength(1)
      return runs[0].run!.split(/\s+/).slice(2)
    })
    const inventory = (flags: string[]) => {
      const result = spawnSync('pnpm', ['exec', ...pkg.scripts['e2e:ci'].split(/\s+/), '--list', '--reporter=json', ...flags],
        { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, env: { ...process.env, CI: 'true' } })
      expect(result.status, result.stderr).toBe(0)
      type Suite = { title?: string; suites?: Suite[]; specs?: { file: string; line: number; column: number; title: string; tests: { projectName: string }[] }[] }
      const rows: string[] = []
      const visit = (suite: Suite, parents: string[] = []) => {
        const titles = suite.title ? [...parents, suite.title] : parents
        for (const spec of suite.specs ?? []) for (const test of spec.tests) rows.push(JSON.stringify([test.projectName, spec.file, spec.line, spec.column, ...titles, spec.title]))
        for (const child of suite.suites ?? []) visit(child, titles)
      }
      visit(JSON.parse(result.stdout) as Suite)
      expect(rows.length).toBeGreaterThan(0)
      expect(new Set(rows).size).toBe(rows.length)
      return rows
    }
    const full = inventory([]), light = inventory(commands[0]), dark = inventory(commands[1]), patternDark = inventory(commands[2])
    expect([...new Set([...light, ...dark, ...patternDark])].sort()).toEqual([...full].sort())
    const repeated = light.filter(row => dark.includes(row))
    expect(repeated.sort()).toEqual(full.filter(row => JSON.parse(row)[0] === 'setup').sort())
    expect(patternDark.filter(row => light.includes(row) || dark.includes(row))).toEqual([])
    expect(full).toHaveLength(577)
    expect(light.length + dark.length + patternDark.length).toBe(579)
    expect(commands.flat().every(flag => /^--project=[a-z-]+$/.test(flag))).toBe(true)
  }, 20_000)

  it('accepts complete selected evidence and preserves documented unselected modes', () => {
    expect(runGate().status).toBe(0)
    for (const [mode, required] of [['docs-only', 'false'], ['production-promotion', 'true'], ['application-test-build', 'true']]) {
      expect(runGate({ CI_MODE: mode, TEST_BUILD_REQUIRED: required, DATABASE_REQUIRED: 'false',
        DATABASE_RESULT: 'skipped', TEST_OWNER_SDK_RESULT: 'skipped', TEST_OWNER_SDK_LIFECYCLE_RESULT: 'skipped' }).status).toBe(0)
    }
    expect(runGate({ CI_MODE: 'full', BROWSER_REQUIRED: 'true', BROWSER_RESULT: 'success', BROWSER_DARK_RESULT: 'success', BROWSER_PATTERN_DARK_RESULT: 'success' }).status).toBe(0)
  })

  it.each(['CLASSIFY_RESULT', 'TEST_BUILD_RESULT', 'DATABASE_RESULT', 'BROWSER_RESULT', 'CI_EVENT_ELIGIBLE'])(
    'retains aggregate rejection for %s after sharding', key => {
      const gate = runGate({ CI_MODE: 'full', BROWSER_REQUIRED: 'true', BROWSER_RESULT: 'success', BROWSER_DARK_RESULT: 'success', BROWSER_PATTERN_DARK_RESULT: 'success',
        [key]: key === 'CI_EVENT_ELIGIBLE' ? 'false' : 'failure' })
      expect(gate.status).toBe(1)
    },
  )

  it('keeps all fresh Test pilot modes and failure receipts while collecting only sanitized timings', () => {
    const workflow = readFileSync(workflowPath, 'utf8')
    for (const profile of ['detail', 'list']) {
      const step = workflow.split(`      - name: Verify isolated contextual Test owner-${profile} SDK reads`)[1]?.split('      - name:')[0]
      expect(step).toContain(`--mode normal --timings-path "$proof_timings_dir/test-owner-${profile}-normal.json"`)
      expect(step).toContain(`for test_owner_${profile}_mode in after-fixture before-capture; do`)
      expect(step).toContain(`--mode "$test_owner_${profile}_mode" --timings-path`)
      expect(step).toContain(`[[ "$test_owner_${profile}_status" -eq 1 ]] || exit 1`)
      expect(step).toContain(`wc -l < "$test_owner_${profile}_log"`)
      expect(step).toContain('" -eq 2 ]] || exit 1')
      expect(step).toContain(`PASS isolated test-owner-${profile} exact teardown and unchanged canonical baseline.`)
      expect(step).not.toMatch(/continue-on-error|wait |tee |\s&\s/)
    }
    const upload = workflow.split('      - name: Upload sanitized Test proof timings')[1]?.split('\n  test-and-build:')[0]
    expect(upload).toContain('if: always()')
    expect(upload).toContain('path: ${{ runner.temp }}/pika-proof-timings/*.json')
    expect(upload).not.toMatch(/startup|\.log|workdir/)
  })
  it('requires a separate serial integrated SDK rehearsal and exact forced-cleanup receipts', () => {
    const workflow = readFileSync(workflowPath, 'utf8')
    const name = '      - name: Verify isolated contextual Assignment integrated SDK effects and private delivery'
    expect(workflow.split(name)).toHaveLength(2)
    const step = workflow.split(name)[1]?.split('      - name:')[0]
    expect(step).toContain('assignment_integrated_head=$(git rev-parse HEAD)')
    expect(step).toContain('pnpm exec tsx scripts/check-contextual-assignment-learner-integrated-lifecycle.ts --reviewed-head "$assignment_integrated_head" --mode normal')
    expect(step).toContain('for assignment_integrated_mode in after-fixture before-capture; do')
    expect(step).toContain('--mode "$assignment_integrated_mode" > "$assignment_integrated_log" 2>&1 || assignment_integrated_status=$?')
    expect(step).toContain('[[ "$assignment_integrated_status" -eq 1 ]] || exit 1')
    expect(step).toContain('[[ "$(wc -l < "$assignment_integrated_log" | tr -d \' \')" -eq 2 ]] || exit 1')
    expect(step).toContain('chmod 600 "$assignment_integrated_log"')
    expect(step).toContain("trap 'rm -f -- \"$assignment_integrated_log\"' EXIT")
    expect(step).toContain('grep -Fx "FAIL forced isolated assignment-learner-integrated lifecycle: ${assignment_integrated_mode}."')
    expect(step).toContain("grep -Fx 'PASS isolated assignment-learner-integrated exact teardown and unchanged canonical baseline.'")
    expect(step).not.toMatch(/continue-on-error|wait |tee |\s&\s/)
    expect(workflow.indexOf('      - name: Verify contextual Assignment inline-image locked Classwork reads')).toBeLessThan(workflow.indexOf(name))
    expect(workflow.indexOf(name)).toBeLessThan(workflow.indexOf('      - name: Verify contextual Daily Log save atomicity and privileges'))
  })
  it('requires locked inline-image reads after supplemental visibility contracts', () => {
    const workflow = readFileSync(workflowPath, 'utf8')
    const name = '      - name: Verify contextual Assignment inline-image locked Classwork reads'
    expect(workflow.split(name)).toHaveLength(2)
    const step = workflow.split(name)[1]?.split('      - name:')[0]
    expect(step).toContain('run: bash scripts/check-contextual-assignment-inline-read-classwork-database.sh')
    expect(step).not.toMatch(/continue-on-error|wait |tee |\s&\s/)
    expect(workflow.indexOf('      - name: Verify contextual assignment-member supplemental visibility')).toBeLessThan(workflow.indexOf(name))
    expect(workflow.indexOf(name)).toBeLessThan(workflow.indexOf('      - name: Verify contextual Daily Log save atomicity and privileges'))
  })
  it('requires supplemental learner visibility checks after member Classwork contracts', () => {
    const workflow = readFileSync(workflowPath, 'utf8')
    const name = '      - name: Verify contextual assignment-member supplemental visibility'
    expect(workflow.split(name)).toHaveLength(2)
    const step = workflow.split(name)[1]?.split('      - name:')[0]
    expect(step).toContain('run: bash scripts/check-contextual-assignment-member-supplement-visibility-database.sh')
    expect(step).not.toMatch(/continue-on-error|wait |tee |\s&\s/)
    expect(workflow.indexOf('      - name: Verify contextual assignment-member locked Classwork concealment')).toBeLessThan(workflow.indexOf(name))
    expect(workflow.indexOf(name)).toBeLessThan(workflow.indexOf('      - name: Verify contextual Daily Log save atomicity and privileges'))
  })
  it('requires locked member Classwork rollback checks after the existing save proof', () => {
    const workflow = readFileSync(workflowPath, 'utf8')
    const name = '      - name: Verify contextual assignment-member locked Classwork concealment'
    expect(workflow.split(name)).toHaveLength(2)
    const step = workflow.split(name)[1]?.split('      - name:')[0]
    expect(step).toContain('run: bash scripts/check-contextual-assignment-member-classwork-database.sh')
    expect(step).not.toMatch(/continue-on-error|wait |tee |\s&\s/)
    expect(workflow.indexOf('      - name: Verify contextual learner assignment-save atomicity and privileges')).toBeLessThan(workflow.indexOf(name))
    expect(workflow.indexOf(name)).toBeLessThan(workflow.indexOf('      - name: Verify contextual Daily Log save atomicity and privileges'))
  })
  it('requires locked Classwork open rollback checks after the existing atomicity proof', () => {
    const workflow = readFileSync(workflowPath, 'utf8')
    const name = '      - name: Verify contextual assignment-open locked Classwork concealment'
    expect(workflow.split(name)).toHaveLength(2)
    const step = workflow.split(name)[1]?.split('      - name:')[0]
    expect(step).toContain('run: bash scripts/check-contextual-assignment-open-classwork-database.sh')
    expect(step).not.toMatch(/continue-on-error|wait |tee |\s&\s/)
    expect(workflow.indexOf('      - name: Verify contextual learner assignment-open atomicity and privileges')).toBeLessThan(workflow.indexOf(name))
    expect(workflow.indexOf(name)).toBeLessThan(workflow.indexOf('      - name: Verify contextual learner assignment-open concurrent authorization'))
  })
  it('requires serial learner open read/projection evidence without claiming actual RPC effects', () => {
    const workflow = readFileSync(workflowPath, 'utf8')
    const name = '      - name: Verify isolated contextual learner Assignment open projections'
    expect(workflow.split(name)).toHaveLength(2)
    const step = workflow.split(name)[1]?.split('      - name:')[0]
    expect(step).toContain('assignment_learner_open_head=$(git rev-parse HEAD)')
    expect(step).toContain('pnpm exec tsx scripts/check-contextual-assignment-learner-open-lifecycle.ts --reviewed-head "$assignment_learner_open_head" --mode normal')
    expect(step).not.toMatch(/wait |tee |\s&\s|continue-on-error/)
    expect(workflow.indexOf('      - name: Verify isolated contextual Assignment student-detail reads')).toBeLessThan(workflow.indexOf(name))
    expect(workflow.indexOf(name)).toBeLessThan(workflow.indexOf('      - name: Verify contextual learner assignment-open atomicity and privileges'))
  })
  it('requires a serial student-detail SDK and revocation observer with no extra fixture authority', () => {
    const workflow = readFileSync(workflowPath, 'utf8')
    const name = '      - name: Verify isolated contextual Assignment student-detail reads'
    expect(workflow.split(name)).toHaveLength(2)
    const step = workflow.split(name)[1]?.split('      - name:')[0]
    expect(step).toContain('assignment_student_detail_head=$(git rev-parse HEAD)')
    expect(step).toContain('pnpm exec tsx scripts/check-contextual-assignment-student-detail-lifecycle.ts --reviewed-head "$assignment_student_detail_head" --mode normal')
    expect(step).not.toMatch(/wait |tee |\s&\s|continue-on-error/)
    expect(workflow.indexOf('      - name: Verify isolated contextual Assignment overview reads')).toBeLessThan(workflow.indexOf(name))
  })
  it('requires an additional serial overview SDK proof using the reviewed existing disposable fixture', () => {
    const workflow = readFileSync(workflowPath, 'utf8')
    const name = '      - name: Verify isolated contextual Assignment overview reads'
    expect(workflow.split(name)).toHaveLength(2)
    const step = workflow.split(name)[1]?.split('      - name:')[0]
    expect(step).toContain('assignment_overview_head=$(git rev-parse HEAD)')
    expect(step).toContain('pnpm exec tsx scripts/check-contextual-assignment-overview-lifecycle.ts --reviewed-head "$assignment_overview_head" --mode normal')
    expect(step).not.toMatch(/wait |tee |\s&\s|continue-on-error/)
    expect(workflow.indexOf('      - name: Verify isolated contextual Assignment list pagination and revocations')).toBeLessThan(workflow.indexOf(name))
  })
  it('requires isolated Assignment list runtime and both exact failed-start cleanup receipts serially', () => {
    const workflow = readFileSync(workflowPath, 'utf8')
    const name = '      - name: Verify isolated contextual Assignment list pagination and revocations'
    expect(workflow.split(name)).toHaveLength(2)
    const step = workflow.split(name)[1]?.split('      - name:')[0]
    expect(step).toContain('assignment_list_head=$(git rev-parse HEAD)')
    expect(step).toContain('pnpm exec tsx scripts/check-contextual-assignment-list-lifecycle.ts --reviewed-head "$assignment_list_head" --mode normal')
    expect(step).toContain('for assignment_list_mode in after-fixture before-capture; do')
    expect(step).toContain('--mode "$assignment_list_mode" > "$assignment_list_log" 2>&1 || assignment_list_status=$?')
    expect(step).toContain('[[ "$assignment_list_status" -eq 1 ]] || exit 1')
    expect(step).toContain('grep -Fx "FAIL forced isolated assignment-list lifecycle: ${assignment_list_mode}."')
    expect(step).toContain("grep -Fx 'PASS isolated assignment-list exact teardown and unchanged canonical baseline.'")
    expect(step).toContain("trap 'rm -f -- \"$assignment_list_log\"' EXIT")
    expect(step).not.toMatch(/wait |tee |\s&\s|continue-on-error/)
  })
  it('requires retained consumer two-session locks and installed-SDK ACL with exact forced baseline receipts', () => {
    const workflow = readFileSync(workflowPath, 'utf8')
    const step = workflow.split('      - name: Verify retained cleanup two-session locks and installed SDK ACL')[1]?.split('      - name:')[0]
    expect(step).toContain('pnpm exec tsx scripts/check-retained-roster-group-locks-database.ts\n')
    expect(step).toContain('pnpm exec tsx scripts/check-retained-roster-group-discovery-sdk.ts\n')
    expect(step).toContain('pnpm exec tsx scripts/check-retained-roster-group-discovery-sdk.ts --force-failure')
    expect(step).toContain('[[ "$group_sdk_status" -eq 1 ]]')
    expect(step).toContain("grep -Fxq 'FAIL forced retained cleanup SDK proof.'")
    expect(step).toContain("grep -Fxq 'PASS retained cleanup SDK unchanged local baseline.'")
    expect(step).not.toMatch(/wait |tee |\s&\s|continue-on-error/)
  })
  it('requires serial shared Assignment real-route proof and exact forced cleanup receipts', () => {
    const workflow = readFileSync(workflowPath, 'utf8')
    const name = '      - name: Rehearse shared Assignment writes and exact failed-fixture cleanup'
    expect(workflow.split(name)).toHaveLength(2)
    const step = workflow.split(name)[1]?.split('      - name:')[0]
    const run = 'bash scripts/rehearse-local-shared-assignment-writes.sh'
    const ack = '--ack=I_UNDERSTAND_THIS_CREATES_AND_REMOVES_ONLY_LOCAL_ASSIGNMENT_FIXTURES'
    expect(step).toContain(`${run} '${ack}' normal > "$shared_assignment_log" 2>&1`)
    expect(step).toContain("grep -Fx 'PASS shared-assignment actual routes and real RPCs; shared cohort only; old pair gates OFF'")
    for (const [mode, failure] of [
      ['after-fixture', 'FORCED_AFTER_FIXTURE'],
      ['before-capture', 'FORCED_COMMIT_BEFORE_CAPTURE'],
    ]) {
      expect(step).toContain(`${run} '${ack}' ${mode} > "$shared_assignment_log" 2>&1 || shared_assignment_status=$?`)
      expect(step).toContain(`grep -Fx 'FAIL shared-assignment ${failure}'`)
    }
    expect(step?.match(/shared_assignment_status=0/g)).toHaveLength(2)
    expect(step?.match(/\[\[ "\$shared_assignment_status" -eq 1 \]\] \|\| exit 1/g)).toHaveLength(2)
    expect(step?.split("grep -Fx 'PASS shared-assignment exact cleanup; whole-row baseline equal; zero residue; guard168 O'")).toHaveLength(4)
    expect(step).toContain("trap 'rm -f -- \"$shared_assignment_log\"' EXIT")
    expect(step).not.toMatch(/wait |tee |\s&\s/)
    expect(workflow.indexOf('      - name: Rehearse contextual Assignment routes against local Supabase')).toBeLessThan(workflow.indexOf(name))
  })

  it('requires group consumer rollback and exact intentional post-teardown failure', () => {
    const workflow = readFileSync(workflowPath, 'utf8')
    const step = workflow.split('      - name: Verify retained roster group consumer rollback contracts')[1]?.split('      - name:')[0]
    expect(step).toContain('bash scripts/check-retained-roster-group-cleanup-database.sh\n')
    expect(step).toContain('bash scripts/check-retained-roster-group-cleanup-database.sh --force-failure')
    expect(step).toContain('[[ "$group_cleanup_status" -eq 1 ]]')
    expect(step).toContain("grep -Fxq 'FAIL forced retained roster group cleanup wrapper failure.'")
    expect(step).toContain("grep -Fxq 'PASS retained roster group cleanup exact teardown.'")
    expect(step).toContain("echo 'FAIL unexpected retained group forced teardown proof.'")
    expect(step).not.toContain('post-commit')
  })

  it('requires genuine roster owner SQL/SDK proofs and exact failed-fixture cleanup', () => {
    const workflow = readFileSync(workflowPath, 'utf8')
    const step = workflow.split('      - name: Verify contextual roster owner writes and failed-fixture cleanup')[1]?.split('      - name:')[0]
    expect(step).toContain('bash scripts/check-contextual-roster-owner-writes-database.sh')
    expect(step).toContain('pnpm exec tsx scripts/check-contextual-roster-owner-writes.ts\n')
    expect(step).toContain('--verify-cleanup-after-fixture')
    expect(step).toContain("grep -F 'Forced roster post-fixture cleanup proof'")
    expect(step).toContain("grep -F 'PASS exact synthetic roster owner-write cleanup, zero residual rows and global baseline counts'")
    expect(step).toContain("echo 'Expected the forced post-fixture failure'")
    expect(step).toContain('exit 1')
  })

  it('requires actual calendar owner SDK and exact failed-fixture cleanup for both proof lanes', () => {
    const workflow = readFileSync(workflowPath, 'utf8')
    const sdk = workflow.split('      - name: Verify contextual calendar owner SDK and failed-fixture cleanup')[1]?.split('      - name:')[0]
    expect(sdk).toContain('pnpm exec tsx scripts/check-contextual-class-day-owner-writes.ts\n')
    expect(sdk).toContain('--verify-cleanup-after-fixture')
    expect(sdk).toContain("grep -F 'FAIL Forced calendar post-fixture cleanup proof'")
    expect(sdk).toContain("grep -F 'PASS exact synthetic calendar owner-write cleanup, zero residual rows and global baseline counts'")
    const concurrency = workflow.split('      - name: Verify contextual calendar concurrent writers')[1]?.split('      - name:')[0]
    expect(concurrency).toContain('node scripts/check-contextual-calendar-concurrency.mjs\n')
    expect(concurrency).toContain('--verify-cleanup-after-fixture')
    expect(concurrency).toContain("grep -F 'FAIL Forced calendar concurrency post-fixture cleanup proof'")
    expect(concurrency).toContain("grep -F 'PASS exact synthetic calendar concurrency cleanup, zero residual rows and global baseline counts'")
    for (const step of [sdk, concurrency]) {
      expect(step).toContain("echo 'Expected the forced post-fixture failure'")
      expect(step).toContain('exit 1')
    }
  })

  it('requires preserving removal SQL/SDK evidence and the exact failed-fixture cleanup', () => {
    const workflow = readFileSync(workflowPath, 'utf8')
    const step = workflow.split('      - name: Verify contextual preserving roster removal and failed-fixture cleanup')[1]?.split('      - name:')[0]
    expect(step).toContain('bash scripts/check-contextual-roster-removal-owner-writes-database.sh')
    expect(step).toContain('pnpm exec tsx scripts/check-contextual-roster-removal-owner-writes.ts\n')
    expect(step).toContain('--verify-cleanup-after-fixture')
    expect(step).toContain('cleanup_status=$?')
    expect(step).toContain('[[ "$cleanup_status" -eq 1 ]]')
    expect(step).toContain("grep -F 'FAIL Forced roster removal post-fixture cleanup proof (expected for --verify-cleanup-after-fixture)'")
    expect(step).toContain("grep -F 'PASS exact synthetic roster removal cleanup, zero residual rows and global baseline counts'")
    expect(step).toContain('--verify-cleanup-after-commit-before-capture')
    expect(step).toContain("grep -F 'FAIL Forced roster removal post-commit pre-capture cleanup proof (expected for --verify-cleanup-after-commit-before-capture)'")
    expect(step).toContain('--verify-cleanup-suppressed-delete-rollback')
    expect(step).toContain("grep -F 'FAIL Forced roster removal suppressed-cleanup rollback proof (expected for --verify-cleanup-suppressed-delete-rollback)'")
    expect(step).toContain("grep -F 'PASS synthetic roster removal suppressed cleanup delete rolled back all cleanup mutations, guard restored'")
  })

  it('requires detail SDK proofs and exact fixture/precapture cleanup failures', () => {
    const workflow = readFileSync(workflowPath, 'utf8')
    const step = workflow.split('      - name: Verify contextual classroom detail reads and exact failed-fixture cleanup')[1]?.split('      - name:')[0]
    expect(step).toContain('pnpm exec tsx scripts/check-contextual-classroom-detail-read.ts\n')
    expect(step).toContain('--verify-cleanup-after-fixture')
    expect(step).toContain('--verify-cleanup-after-commit-before-capture')
    expect(step).toContain('[[ "$cleanup_status" -eq 1 ]]')
    expect(step).toContain("grep -F 'FAIL Forced classroom detail post-fixture cleanup proof (expected for --verify-cleanup-after-fixture)'")
    expect(step).toContain("grep -F 'FAIL Forced classroom detail post-commit pre-capture cleanup proof (expected for --verify-cleanup-after-commit-before-capture)'")
    expect(step).toContain("grep -F 'PASS exact synthetic classroom detail cleanup, zero residual rows and global baseline counts'")
  })

  it('registers serial metadata SQL/SDK proofs with complete normal and exact forced cleanup receipts', () => {
    const workflow = readFileSync(workflowPath, 'utf8')
    const name = '      - name: Verify contextual classroom metadata and exact failed-fixture cleanup'
    expect(workflow.split(name)).toHaveLength(2)
    const step = workflow.split(name)[1]?.split('      - name:')[0]
    expect(step).toBeDefined()
    const sql = 'bash scripts/check-contextual-classroom-metadata-database.sh'
    const sdk = 'pnpm exec tsx scripts/check-contextual-classroom-metadata.ts'
    expect(step).toContain(sql)
    expect(step).toContain(`${sdk} > "$metadata_sdk_log"`)
    expect(step?.indexOf(sql)).toBeLessThan(step?.indexOf(sdk) ?? -1)
    for (const marker of [
      'PASS metadata rollback-only direct contracts, full owner output, genuine slug collision and suppression/substitution/late trigger faults restore metadata and both revision effects',
      'PASS metadata actual SDK both owner roles, exact normalized body/full owner hydration and strict wire failures without replay',
      'PASS metadata deterministic observed-blocking transfer/archive/slug/publication races preserve current authority and publishing invariants',
      'PASS metadata committed-write lost-response uncertainty is reported without replay and no creation entitlement is required',
    ]) expect(step).toContain(`grep -Fx '${marker}'`)
    const cleanup = "grep -Fx 'PASS exact synthetic metadata cleanup, zero residual rows and global whole-row baseline counts'"
    expect(step?.split(cleanup)).toHaveLength(4)
    expect(step?.match(/\[\[ "\$metadata_cleanup_status" -eq 1 \]\] \|\| exit 1/g)).toHaveLength(2)
    for (const [flag, failure] of [
      ['--verify-cleanup-after-fixture', 'post-fixture'],
      ['--verify-cleanup-after-commit-before-capture', 'post-commit pre-capture'],
    ]) {
      expect(step).toContain(`${sdk} ${flag} > "$metadata_cleanup_log" 2>&1 || metadata_cleanup_status=$?`)
      expect(step).toContain(`grep -Fx 'FAIL Forced metadata ${failure} cleanup proof (expected for ${flag})'`)
    }
    expect(step?.match(/metadata_cleanup_status=0/g)).toHaveLength(2)
    expect(step?.match(/="\$\(mktemp\)"/g)).toHaveLength(3)
    expect(step).toContain("trap 'rm -f -- \"$metadata_sql_log\" \"$metadata_sdk_log\" \"$metadata_cleanup_log\"' EXIT")
    expect(step).not.toMatch(/wait |tee |\s&\s/)
  })

  it('defers heavy draft checks and runs comprehensive validation on a stable ready SHA', () => {
    const workflow = readFileSync(workflowPath, 'utf8')

    expect(workflow).toMatch(
      /^  pull_request:\n    branches: \[main, production\]\n    types: \[opened, synchronize, reopened, ready_for_review, converted_to_draft\]$/m,
    )
    expect(workflow).toContain('  workflow_dispatch:')
    expect(workflow).not.toMatch(/^  push:/m)

    expect(workflow).toContain('group: ci-${{ github.event.pull_request.number || github.ref }}')
    expect(workflow).toContain('cancel-in-progress: true')
    expect(workflow).toContain("github.event.action == 'ready_for_review'")
    expect(workflow).toContain(
      'Ready pull request changed after its stable-SHA request. Convert it to draft before pushing, then mark the reviewed SHA ready again.',
    )

    expect(workflow).toContain('name: Classify Changes')
    expect(workflow).toContain('name: Architecture Database Contracts')
    expect(workflow).toContain('name: Test & Build')
    expect(workflow).toContain('name: Browser Experience Matrix')
    expect(workflow).toContain('name: PR Gate')
    expect(workflow).toContain(
      'supabase db lint --local --level error --fail-on error',
    )
  })

  it('uses a fail-closed classifier and a transition-safe aggregate gate', () => {
    const workflow = readFileSync(workflowPath, 'utf8')

    expect(workflow).toContain('node scripts/classify-ci-changes.mjs --full')
    expect(workflow).toContain('--target "$TARGET_BRANCH"')
    expect(workflow).toContain('--head-branch "$HEAD_BRANCH"')
    expect(workflow).toContain('--main-sha "$MAIN_SHA"')
    expect(workflow).toContain('--head-repository "$HEAD_REPOSITORY"')
    expect(workflow).toContain('--base-repository "$BASE_REPOSITORY"')
    expect(workflow).toContain("if: needs.classify-changes.outputs.run_database == 'true'")
    expect(workflow).toContain("if: needs.classify-changes.outputs.run_browser == 'true'")
    expect(workflow).toContain("if: needs.classify-changes.result == 'success'")
    expect(workflow).toContain('run: pnpm run check:workflow')
    expect(workflow).toContain('Verify every selected check passed')
    expect(workflow).toContain('CI_EVENT_ELIGIBLE: ${{ github.event_name == \'workflow_dispatch\' || github.event.action == \'ready_for_review\' }}')
    expect(workflow).toContain('Invalid or inconsistent CI selectors')
    expect(workflow).toContain('TEST_BUILD_REQUIRED: ${{ needs.classify-changes.outputs.run_test_build }}')
    expect(workflow).toContain('full:true:true:true')
    expect(workflow).toContain('docs-only:false:false:false')
    expect(workflow).toContain(
      'Architecture Database Contracts were required but ended: $DATABASE_RESULT',
    )
    expect(workflow).toContain(
      'Browser Experience Matrix was required but ended: $BROWSER_RESULT',
    )
  })

  it('uses three guarded setups with every existing contract selected in its configured projects', () => {
    const workflow = readFileSync(workflowPath, 'utf8')

    expect(workflow).toContain('name: Run combined browser contracts')
    expect(workflow.match(/run: pnpm e2e:ci --project=/g)).toHaveLength(3)
    for (const id of ['browser-experience-matrix', 'browser-experience-dark', 'browser-pattern-lab-dark']) {
      const body = jobSource(workflow, id)
      expect(body).toContain("if: needs.classify-changes.outputs.run_browser == 'true'")
      expect(body).toContain('timeout-minutes: 90')
      expect(body).toContain('run: pnpm seed')
      expect(body).toContain('pnpm exec playwright install --with-deps chromium')
      expect(body).toContain('name: ' + id)
      expect(body).toContain('playwright-report/\n            test-results/')
    }
    expect(workflow).not.toContain('run: pnpm e2e:matrix')
    expect(workflow).not.toContain('run: pnpm e2e:student-purge')
    expect(workflow).not.toContain('run: pnpm e2e:archive-recovery')
  })

  it('caches immutable setup inputs without caching database safety state', () => {
    const workflow = readFileSync(workflowPath, 'utf8')

    expect(workflow).toContain('id: database-pnpm-cache')
    expect(workflow).toContain('id: browser-pnpm-cache')
    expect(workflow).toContain('id: playwright-cache')
    expect(workflow).toContain('path: ~/.cache/ms-playwright')
    expect(workflow).toContain('pnpm exec playwright install --with-deps chromium')
    expect(workflow).toContain('Database lane setup evidence')
    expect(workflow).toContain('Browser lane setup evidence')
    expect(workflow).toContain('(false means prefix restore or miss)')
    expect(workflow).toContain('Supabase remains a fresh ephemeral start and migration replay.')
    expect(workflow.match(/supabase start -x analytics,edge-runtime,functions,imgproxy,inbucket,meta,realtime,studio,vector/g)).toHaveLength(7)
  })

  it('keeps UI policies in Test & Build and uploads coverage only for failures', () => {
    const workflow = readFileSync(workflowPath, 'utf8')

    expect(existsSync(retiredUiWorkflowPath)).toBe(false)
    expect(workflow.match(/run: pnpm run check:ui-policy/g)).toHaveLength(1)
    expect(workflow.match(/run: pnpm run check:design-policy/g)).toHaveLength(1)
    expect(workflow).toContain('name: "Check No dark: Classes in App Code"')
    expect(workflow).toMatch(
      /- name: Upload coverage reports\n\s+if: failure\(\) && needs\.classify-changes\.outputs\.run_test_build == 'true'\n\s+uses: actions\/upload-artifact@v7/,
    )
  })
})
