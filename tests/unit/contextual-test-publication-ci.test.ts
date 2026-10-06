import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('publication isolated CI closure', () => {
  it('runs normal and both forced-cleanup modes serially with exact receipts and unchanged budgets', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
    const name = '      - name: Verify isolated contextual Test owner publication transactions'
    expect(workflow.split(name)).toHaveLength(2)
    const step = workflow.split(name)[1].split('      - name:')[0]
    expect(step).toContain('test_owner_publication_head=$(git rev-parse HEAD)')
    expect(step).toContain('pnpm exec tsx scripts/check-contextual-test-owner-publication-lifecycle.ts --reviewed-head "$test_owner_publication_head" --mode normal')
    expect(step).toContain('for test_owner_publication_mode in after-fixture before-capture; do')
    expect(step).toContain('--mode "$test_owner_publication_mode" > "$test_owner_publication_log" 2>&1 || test_owner_publication_status=$?')
    expect(step).toContain('[[ "$test_owner_publication_status" -eq 1 ]] || exit 1')
    expect(step).toContain('[[ "$(wc -l < "$test_owner_publication_log" | tr -d \' \')" -eq 2 ]] || exit 1')
    expect(step).toContain('chmod 600 "$test_owner_publication_log"')
    expect(step).toContain("trap 'rm -f -- \"$test_owner_publication_log\"' EXIT")
    expect(step).toContain('grep -Fx "FAIL forced isolated test-owner-publication lifecycle: ${test_owner_publication_mode}."')
    expect(step).toContain("grep -Fx 'PASS isolated test-owner-publication exact teardown and unchanged canonical baseline.'")
    expect(step).not.toMatch(/continue-on-error|--generate-types|wait |tee |\s&\s/)
    expect(workflow.indexOf('      - name: Verify isolated contextual pristine Test draft discard transactions')).toBeLessThan(workflow.indexOf(name))
    expect(workflow.indexOf(name)).toBeLessThan(workflow.indexOf('      - name: Verify contextual Daily Log save atomicity and privileges'))
    expect(workflow.match(/name: Architecture Database Contracts[\s\S]*?timeout-minutes: (\d+)/)?.[1]).toBe('90')
  })
})
