import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('contextual pristine Test draft discard CI evidence', () => {
  it('runs251 normal and both exact forced cleanup modes serially without changing limits', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
    const job = workflow.split('  contextual-test-owner-sdk-lifecycle:\n')[1]?.split(/\n  [a-z][a-z-]*:\n/)[0]
    const sibling = workflow.split('  contextual-test-owner-sdk:\n')[1]?.split(/\n  [a-z][a-z-]*:\n/)[0]
    const database = workflow.split('  architecture-database-contracts:\n')[1]?.split(/\n  [a-z][a-z-]*:\n/)[0]
    expect(job).toBeDefined()
    expect(database).toContain('run: pnpm run db:types:check')
    expect(database).toContain('name: Rehearse the production-shaped Test identity migration')
    expect(database).toContain('name: Verify contextual Daily Log save atomicity and privileges')
    const name = '      - name: Verify isolated contextual pristine Test draft discard transactions'
    expect(workflow.split(name)).toHaveLength(2)
    expect(job!.split(name)).toHaveLength(2)
    const step = job!.split(name)[1].split('      - name:')[0]
    expect(step).toContain('test_owner_pristine_discard_head=$(git rev-parse HEAD)')
    expect(step).toContain('pnpm exec tsx scripts/check-contextual-test-owner-pristine-discard-lifecycle.ts --reviewed-head "$test_owner_pristine_discard_head" --mode normal')
    expect(step).toContain('for test_owner_pristine_discard_mode in after-fixture before-capture; do')
    expect(step).toContain('--mode "$test_owner_pristine_discard_mode" > "$test_owner_pristine_discard_log" 2>&1 || test_owner_pristine_discard_status=$?')
    expect(step).toContain('[[ "$test_owner_pristine_discard_status" -eq 1 ]] || exit 1')
    expect(step).toContain('[[ "$(wc -l < "$test_owner_pristine_discard_log" | tr -d \' \')" -eq 2 ]] || exit 1')
    expect(step).toContain('chmod 600 "$test_owner_pristine_discard_log"')
    expect(step).toContain("trap 'rm -f -- \"$test_owner_pristine_discard_log\"' EXIT")
    expect(step).toContain('grep -Fx "FAIL forced isolated test-owner-pristine-discard lifecycle: ${test_owner_pristine_discard_mode}."')
    expect(step).toContain("grep -Fx 'PASS isolated test-owner-pristine-discard exact teardown and unchanged canonical baseline.'")
    expect(step).not.toMatch(/continue-on-error|--generate-types|wait |tee |\s&\s/)
    expect(job).toContain('id: ci-isolation')
    expect(job).toContain('id: supabase-start')
    expect(job).toContain("if: always() && steps.ci-isolation.outcome == 'success' && steps.supabase-start.outcome != 'skipped'")
    expect(job).toContain('name: Start ephemeral Supabase and replay migrations')
    expect(job).toContain('name: Stop ephemeral database')
    expect(job!.indexOf('id: ci-isolation')).toBeLessThan(job!.indexOf('id: supabase-start'))
    expect(job!.indexOf('name: Start ephemeral Supabase and replay migrations')).toBeLessThan(job!.indexOf(name))
    expect(job!.indexOf(name)).toBeLessThan(job!.indexOf('name: Stop ephemeral database'))
    expect(job).not.toContain('name: Verify isolated contextual Test owner creation transactions')
    expect(sibling).toContain('name: Verify isolated contextual Test owner creation transactions')
    expect(job).toContain('name: Verify isolated contextual Test owner publication transactions')
    expect(job!.indexOf(name)).toBeLessThan(job!.indexOf('      - name: Verify isolated contextual Test owner publication transactions'))
    expect(sibling).toContain('runs-on: ubuntu-latest')
    expect(sibling).toContain('run: node scripts/ci-runner-preflight.mjs --lane test-owner-sdk')
    expect(sibling).toContain('run: supabase start -x analytics,edge-runtime,functions,imgproxy,inbucket,meta,realtime,studio,vector')
    expect(sibling).toContain("if: always() && steps.ci-isolation.outcome == 'success' && steps.supabase-start.outcome != 'skipped'")
    expect(sibling).toContain('run: supabase stop --no-backup')
    expect(sibling!.indexOf('id: ci-isolation')).toBeLessThan(sibling!.indexOf('id: supabase-start'))
    expect(sibling!.indexOf('name: Start ephemeral Supabase and replay migrations')).toBeLessThan(sibling!.indexOf('      - name: Verify isolated contextual Test owner creation transactions'))
    expect(sibling!.indexOf('      - name: Verify isolated contextual Test owner creation transactions')).toBeLessThan(sibling!.indexOf('name: Stop ephemeral database'))
    expect(sibling!.match(/^    timeout-minutes: (\d+)/m)?.[1]).toBe('90')
    expect(job!.match(/^    timeout-minutes: (\d+)/m)?.[1]).toBe('90')
    expect(workflow.match(/name: Architecture Database Contracts[\s\S]*?timeout-minutes: (\d+)/)?.[1]).toBe('90')
  })
})
