import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('contextual member Test-list CI evidence', () => {
  it('requires serial exact-head normal and both fully set-up forced-cleanup proofs', () => {
    const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8')
    const job = workflow.split('  architecture-database-contracts:\n')[1]?.split(/\n  [a-z][a-z-]*:\n/)[0]
    const database = workflow.split('  architecture-database-contracts:\n')[1]?.split(/\n  [a-z][a-z-]*:\n/)[0]
    const lifecycle = workflow.split('  architecture-database-contracts-lifecycle:\n')[1]?.split(/\n  [a-z][a-z-]*:\n/)[0]
    expect(job).toBeDefined()
    expect(lifecycle).toBeDefined()
    expect(database).toContain('run: pnpm run db:types:check')
    expect(database).toContain('name: Rehearse the production-shaped Test identity migration')
    expect(lifecycle).toContain('name: Verify contextual Daily Log save atomicity and privileges')
    expect(database).not.toContain('name: Verify contextual Daily Log save atomicity and privileges')
    const name = '      - name: Verify isolated contextual Test member-list SDK reads'
    expect(workflow.split(name)).toHaveLength(2)
    expect(job!.split(name)).toHaveLength(2)
    const step = job!.split(name)[1]?.split('      - name:')[0]
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
    expect(job).toContain('id: ci-isolation')
    expect(job).toContain('id: supabase-start')
    expect(job).toContain("if: always() && steps.ci-isolation.outcome == 'success' && steps.supabase-start.outcome != 'skipped'")
    expect(job).toContain('name: Start ephemeral Supabase and replay migrations')
    expect(job).toContain('name: Stop ephemeral database')
    expect(job!.indexOf('id: ci-isolation')).toBeLessThan(job!.indexOf('id: supabase-start'))
    expect(job!.indexOf('name: Start ephemeral Supabase and replay migrations')).toBeLessThan(job!.indexOf(name))
    expect(job!.indexOf(name)).toBeLessThan(job!.indexOf('name: Stop ephemeral database'))
    expect(job).toContain('name: Verify isolated contextual Assignment integrated SDK effects and private delivery')
    expect(lifecycle).toContain('name: Verify isolated contextual Test owner reorder transactions')
    expect(job).not.toContain('name: Verify isolated contextual Test owner reorder transactions')
    expect(lifecycle).not.toContain('name: Verify isolated contextual Test member-list SDK reads')
    expect(job!.indexOf('      - name: Verify isolated contextual Assignment integrated SDK effects and private delivery')).toBeLessThan(job!.indexOf(name))
    expect(job!.match(/^    timeout-minutes: (\d+)/m)?.[1]).toBe('90')
  })
})
