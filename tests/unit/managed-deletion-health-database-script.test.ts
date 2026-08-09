import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = readFileSync(resolve(
  process.cwd(),
  'scripts/check-managed-deletion-health-database.sh',
), 'utf8')

describe('managed deletion health database harness', () => {
  it('refuses an unexpected database container and requires migration 121', () => {
    expect(script).toContain('com.supabase.cli.project')
    expect(script).toContain('PROJECT_LABEL" != "pika"')
    expect(script).toContain("version = '121'")
    expect(script).not.toContain('--linked')
    expect(script).not.toContain('--db-url')
  })

  it('uses rollback-only synthetic findings and a fixed provider-side helper', () => {
    expect(script).toContain('begin read only;')
    expect(script.match(/rollback;/g)).toHaveLength(3)
    expect(script).toContain(
      'storage.insert_managed_deletion_health_reappearance_fixture()',
    )
    expect(script).toContain("'monitor-fixture/reappeared.pdf'")
    expect(script).toContain('trap cleanup_storage_helper EXIT')
  })

  it('checks privacy, privileges, thresholds, runtime, and concurrent readers', () => {
    expect(script).toContain("has_function_privilege(\n      'anon'")
    expect(script).toContain('managed_deletion_health_stuck_threshold_invalid')
    expect(script).toContain('Identity-bearing evidence escaped')
    expect(script).toContain('generate_series(1, 1000)')
    expect(script).toContain('v_elapsed_ms >= 5000')
    expect(script).toContain('explain (analyze, buffers, summary)')
    expect(script).toContain('xargs -P8')
  })
})
