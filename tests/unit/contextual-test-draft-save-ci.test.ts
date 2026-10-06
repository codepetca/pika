import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('contextual Test draft save CI evidence', () => {
  it('runs the additional normal proof and both exact forced-cleanup modes serially', () => {
    const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8')
    const name = '      - name: Verify isolated contextual Test owner-draft save transactions'
    expect(workflow.split(name)).toHaveLength(2)
    const step = workflow.split(name)[1]?.split('      - name:')[0]
    expect(step).toContain('test_owner_draft_save_head=$(git rev-parse HEAD)')
    expect(step).toContain('pnpm exec tsx scripts/check-contextual-test-owner-draft-save-lifecycle.ts --reviewed-head "$test_owner_draft_save_head" --mode normal')
    expect(step).toContain('for test_owner_draft_save_mode in after-fixture before-capture; do')
    expect(step).toContain('--mode "$test_owner_draft_save_mode" > "$test_owner_draft_save_log" 2>&1 || test_owner_draft_save_status=$?')
    expect(step).toContain('[[ "$test_owner_draft_save_status" -eq 1 ]] || exit 1')
    expect(step).toContain('[[ "$(wc -l < "$test_owner_draft_save_log" | tr -d \' \')" -eq 2 ]] || exit 1')
    expect(step).toContain('chmod 600 "$test_owner_draft_save_log"')
    expect(step).toContain("trap 'rm -f -- \"$test_owner_draft_save_log\"' EXIT")
    expect(step).toContain('grep -Fx "FAIL forced isolated test-owner-draft-save lifecycle: ${test_owner_draft_save_mode}."')
    expect(step).toContain("grep -Fx 'PASS isolated test-owner-draft-save exact teardown and unchanged canonical baseline.'")
    expect(step).not.toMatch(/continue-on-error|wait |tee |\s&\s/)
    expect(workflow.indexOf('      - name: Verify isolated contextual Test owner-draft GET transactions')).toBeLessThan(workflow.indexOf(name))
    expect(workflow.indexOf(name)).toBeLessThan(workflow.indexOf('      - name: Verify contextual Daily Log save atomicity and privileges'))
  })
})
