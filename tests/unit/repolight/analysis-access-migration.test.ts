import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/296_repolight_analysis_access.sql', 'utf8')
const original = readFileSync('supabase/migrations/293_repolight_report_service.sql', 'utf8')
const body = (sql: string, name: string) => {
  const start = sql.indexOf(`function public.${name}(`)
  return sql.slice(start, sql.indexOf('end $$;', start) + 'end $$;'.length)
}
describe('RepoLight analysis entitlement migration contract', () => {
  it('locks billing settings before RepoLight settings and the account fence', () => {
    const start = migration.indexOf('create function private.lock_repolight_analysis_access_v1')
    const lock = migration.slice(start, migration.indexOf('end $$;', start))
    const billing = lock.indexOf('from private.stripe_billing_settings where singleton for share;')
    expect(billing).toBeGreaterThan(0)
    expect(billing).toBeLessThan(lock.indexOf('from private.repolight_settings where singleton for share;'))
    expect(billing).toBeLessThan(lock.indexOf('perform pg_advisory_xact_lock'))
  })
  it('changes the historical operational bodies only at the explicit lock/admission boundaries', () => {
    for (const name of ['begin_assignment_repolight_run_v1', 'advance_assignment_repolight_run_v1']) {
      let expected = body(original, name)
      expected = expected.replace('begin\n', 'begin\n -- Acquire account fences before the historical target locks, even when dormant.\n perform private.lock_repolight_analysis_access_v1(p_actor_id);\n')
      if (name.startsWith('begin_')) {
        const target = 'cid:=private.authorize_repolight_target_v1(p_actor_id,p_assignment_id,p_student_id,true);'
        expected = expected.replace(target, target + '\n perform private.assert_repolight_analysis_access_v1(p_actor_id);')
      } else {
        const target = "if r.source_json is distinct from private.repolight_source_v1(p_assignment_id,p_student_id) then raise exception using errcode='40001',message='repolight_source_changed';end if;"
        expected = expected.replace(target, target + "\n -- A known remote job may settle after expiry. Unknown outcomes still require\n -- create permission: reconcileAnalysis re-POSTs create and can start work.\n if r.analysis_id is null and p_action in ('claim','authorize') then\n  perform private.assert_repolight_analysis_access_v1(p_actor_id);\n end if;")
      }
      expect(body(migration, name)).toBe(expected)
    }
  })
  it('adds read-only eligibility projection without imposing a paid check on reads', () => {
    for (const name of ['read_assignment_repolight_run_v1', 'get_assignment_repolight_source_v1']) {
      const projected = body(migration, name)
      expect(projected).toContain("'analysis_access',public.get_repolight_analysis_access_v1(p_actor_id)")
      expect(projected).not.toContain('assert_repolight_analysis_access_v1')
    }
  })
  it('leaves feedback and erasure bodies untouched', () => {
    for (const name of ['import_assignment_repolight_feedback_v1', 'begin_repolight_subject_erasure_v1', 'record_repolight_subject_erasure_v1']) {
      expect(migration).not.toContain(`function public.${name}(`)
    }
  })
  it('samples the database clock after the plan/feature fences and uses exclusive cutoffs', () => {
    const resolver = body(migration, 'get_repolight_analysis_access_v1')
    expect(resolver.indexOf('now_at := clock_timestamp()')).toBeGreaterThan(resolver.indexOf('perform private.lock_repolight_analysis_access_v1'))
    expect(resolver).toContain('now_at >= access.access_ends_at')
    expect(resolver).toContain("version.features->'repolight_analysis' is distinct from 'true'::jsonb")
    expect(resolver).not.toContain('billing_get_access_status_v1(')
  })
})
