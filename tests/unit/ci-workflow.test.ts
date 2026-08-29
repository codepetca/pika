import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflowPath = resolve(process.cwd(), '.github/workflows/ci.yml')
const retiredUiWorkflowPath = resolve(process.cwd(), '.github/workflows/ui-policy.yml')

describe('CI workflow', () => {
  it('defers heavy draft checks and runs comprehensive validation on a stable ready SHA', () => {
    const workflow = readFileSync(workflowPath, 'utf8')

    expect(workflow).toMatch(
      /^  pull_request:\n    branches: \[main, production\]\n    types: \[opened, synchronize, reopened, ready_for_review, converted_to_draft\]$/m,
    )
    expect(workflow).toContain('  workflow_dispatch:')
    expect(workflow).not.toMatch(/^  push:/m)

    expect(workflow).toContain('group: ci-${{ github.event.pull_request.number || github.ref }}')
    expect(workflow).toContain('cancel-in-progress: true')
    expect(workflow).toContain(
      "if: github.event_name == 'workflow_dispatch' || github.event.pull_request.draft == false",
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
    expect(workflow).toContain('Invalid or inconsistent CI selectors')
    expect(workflow).toContain('full:true:true')
    expect(workflow).toContain('docs-only:false:false')
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
