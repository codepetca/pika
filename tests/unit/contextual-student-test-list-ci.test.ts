import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('contextual member Test-list CI evidence', () => {
  it('requires serial exact-head normal and both fully set-up forced-cleanup proofs', () => {
    const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8')
    const name = '      - name: Verify isolated contextual Test member-list SDK reads'
    expect(workflow.split(name)).toHaveLength(2)
    const step = workflow.split(name)[1]?.split('      - name:')[0]
    expect(step).toContain('test_member_list_head=$(git rev-parse HEAD)')
    expect(step).toContain('pnpm exec tsx scripts/check-contextual-test-member-list-lifecycle.ts --reviewed-head "$test_member_list_head" --mode normal')
    expect(step).toContain('for test_member_list_mode in after-fixture before-capture; do')
    expect(step).toContain('--mode "$test_member_list_mode" > "$test_member_list_log" 2>&1 || test_member_list_status=$?')
    expect(step).toContain('[[ "$test_member_list_status" -eq 1 ]] || exit 1')
    expect(step).toContain('[[ "$(wc -l < "$test_member_list_log" | tr -d \' \')" -eq 2 ]] || exit 1')
    expect(step).toContain('chmod 600 "$test_member_list_log"')
    expect(step).toContain("trap 'rm -f -- \"$test_member_list_log\"' EXIT")
    expect(step).toContain('grep -Fx "FAIL forced isolated test-member-list lifecycle: ${test_member_list_mode}."')
    expect(step).toContain("grep -Fx 'PASS isolated test-member-list exact teardown and unchanged canonical baseline.'")
    expect(step).not.toMatch(/wait |tee |\s&\s|continue-on-error/)
    expect(workflow.indexOf('      - name: Verify isolated contextual Test owner-list SDK reads')).toBeLessThan(workflow.indexOf(name))
    expect(workflow.indexOf(name)).toBeLessThan(workflow.indexOf('      - name: Verify isolated contextual Test owner-draft GET transactions'))
  })
})
