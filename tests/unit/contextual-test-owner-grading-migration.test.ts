import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationPath = 'supabase/migrations/258_contextual_test_owner_grading.sql'
describe('contextual owner grading additive source contract (native proof required separately)', () => {
  it('preserves every historical branch while extending the existing service-only signature', () => {
    const sql = readFileSync(migrationPath, 'utf8')
    const previous = readFileSync('supabase/migrations/256_contextual_test_owner_workflow.sql', 'utf8')
    const oldBranches = previous.slice(previous.indexOf("  elsif p_operation = 'update' then"), previous.indexOf("\n  if p_operation in ('reserve','upload','verify') then"))
    expect(sql).toContain(oldBranches)
    expect(sql).toContain('create or replace function public.test_owner_workflow_v1(')
    expect(sql).toContain('from public, anon, authenticated;')
    expect(sql).toContain('to service_role;')
    for (const operation of ['results', 'manual-save', 'clear-open-grades', 'return']) expect(sql).toContain(`'${operation}'`)
    for (const writer of ['save_test_response_grades_with_provenance_atomic', 'clear_test_open_response_grades_atomic', 'return_test_attempts_checked_atomic']) expect(sql).toContain(`public.${writer}(`)
    expect(sql).not.toContain('update public.test_responses')
    expect(sql).not.toContain('update public.test_attempts')
  })
  it('bounds the coherent read and keeps AI exclusion inside the shared lock', () => {
    const sql = readFileSync(migrationPath, 'utf8')
    expect(sql.indexOf('pg_try_advisory_xact_lock')).toBeLessThan(sql.indexOf('test_owner_active_ai_run'))
    expect(sql).toContain("status in ('queued','running')")
    expect(sql).toContain('test_owner_results_source_limit')
    expect(sql).toContain('test_owner_results_run_roster_changed')
    expect(sql).toContain('test_owner_postcondition')
    expect(sql).toContain("p_operation in ('update','sync','manual-save','clear-open-grades','return')")
    expect(sql).toContain('v_result::text')
  })
  it('measures expanded row JSON before array aggregation and declares the PostgREST-hoisted statement timeout', () => {
    const sql = readFileSync(migrationPath, 'utf8')
    const bounds = sql.slice(sql.indexOf('), bounds as ('), sql.indexOf('select bounds.invalid,bounds.bytes,'))
    expect(bounds).not.toContain('pg_column_size')
    expect(bounds.match(/octet_length\(to_jsonb\(\w+\)::text\)/g)).toHaveLength(10)
    expect(sql).toContain("set statement_timeout = '8s'")
    expect(sql).toContain('PostgREST hoists statement_timeout before executing the RPC statement')
    // JSON escaping alone defeats a physical/raw-text byte proxy even before
    // database compression enters the picture. This is a semantic JS example,
    // not proof of PostgreSQL TOAST sizing or cancellation behavior.
    const escaped = '\u0001'.repeat(200000)
    expect(Buffer.byteLength(escaped)).toBeLessThan(1048576)
    expect(Buffer.byteLength(JSON.stringify({ response_text: escaped }))).toBeGreaterThan(1048576)
  })
})
