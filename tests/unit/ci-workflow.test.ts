import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflowPath = resolve(process.cwd(), '.github/workflows/ci.yml')
const retiredUiWorkflowPath = resolve(process.cwd(), '.github/workflows/ui-policy.yml')

describe('CI workflow', () => {
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

  it('reuses one browser setup for every CI browser contract', () => {
    const workflow = readFileSync(workflowPath, 'utf8')

    expect(workflow).toContain('name: Run combined browser contracts')
    expect(workflow).toContain('run: pnpm e2e:ci')
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
    expect(workflow.match(/supabase start -x analytics,edge-runtime,functions,imgproxy,inbucket,meta,realtime,studio,vector/g)).toHaveLength(2)
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
