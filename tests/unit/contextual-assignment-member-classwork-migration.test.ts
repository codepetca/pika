import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeClassroomFeatureVisibility } from '@/lib/classroom-feature-visibility'

const prior = readFileSync('supabase/migrations/214_contextual_assignment_owner_precedence.sql', 'utf8')
const migration = () => readFileSync('supabase/migrations/241_contextual_assignment_member_classwork.sql', 'utf8')
const harness = () => readFileSync('scripts/check-contextual-assignment-member-classwork-database.sh', 'utf8')
const names = [
  'save_assignment_doc_for_member_v1',
  'submit_assignment_doc_for_member_v1',
  'unsubmit_assignment_doc_for_member_v1',
  'prepare_assignment_doc_submission_for_member_v1',
] as const
const predicate =
  "    -- Match normalization: only an object with JSON boolean false hides Classwork.\n" +
  "    or (jsonb_typeof(v_feature_visibility) = 'object'\n" +
  "      and v_feature_visibility->'classwork' = 'false'::jsonb)\n"

function definition(source: string, name: string): string {
  const found = source.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$function\\$;`))
  if (!found) throw new Error(`Missing complete definition: ${name}`)
  return found[0]
}

function acl(source: string, name: string): string {
  const found = source.match(new RegExp(`revoke all on function public\\.${name}\\([^;]+;\\s+grant execute on function public\\.${name}\\([^;]+;`))
  if (!found) throw new Error(`Missing service-only ACL: ${name}`)
  return found[0]
}

describe('contextual Assignment member Classwork visibility', () => {
  describe.each(names)('%s', (name) => {
    it('records the 214 gap in the existing locked authorization boundary', () => {
      const body = definition(prior, name)
      expect(body).toContain('if v_teacher_id = p_actor_id then')
      expect(body).toContain('from public.classroom_enrollments as enrollment')
      expect(body).toMatch(/for (?:update|share) of classroom, assignment;/)
      expect(body).not.toContain('feature_visibility')
      expect(body).not.toContain('classwork')
    })

    it('conceals after locked owner precedence and before membership, content, history or Pal work', () => {
      const body = definition(migration(), name)
      const lock = body.search(/for (?:update|share) of classroom, assignment;/)
      const owner = body.indexOf('if v_teacher_id = p_actor_id then')
      const hidden = body.indexOf("jsonb_typeof(v_feature_visibility) = 'object'")
      const membership = body.indexOf('from public.classroom_enrollments as enrollment')
      expect(body).toContain('  v_feature_visibility jsonb;')
      expect(lock).toBeGreaterThan(body.indexOf('classroom.feature_visibility'))
      expect(owner).toBeGreaterThan(lock)
      expect(hidden).toBeGreaterThan(owner)
      expect(membership).toBeGreaterThan(hidden)
      expect(body.slice(owner, hidden)).toContain("errcode = '42501', message = 'Forbidden'")
      expect(body.slice(hidden, membership)).toContain("errcode = 'P0002', message = 'Assignment not found'")
      const operation = {
        save_assignment_doc_for_member_v1: 'v_result := public.save_assignment_doc_atomic(',
        submit_assignment_doc_for_member_v1: 'if p_pal_event is not null then',
        unsubmit_assignment_doc_for_member_v1: 'v_result := public.unsubmit_assignment_doc_atomic(',
        prepare_assignment_doc_submission_for_member_v1: 'select doc.*',
      }[name]
      expect(body.indexOf(operation)).toBeGreaterThan(membership)
    })

    it('byte-preserves the complete 214 definition after stripping only the allowed additions', () => {
      const replacement = definition(migration(), name)
      for (const addition of ['  v_feature_visibility jsonb;\n', '    classroom.feature_visibility\n', '    v_feature_visibility\n', predicate]) {
        expect(replacement.split(addition)).toHaveLength(2)
      }
      expect(replacement
        .replace('  v_feature_visibility jsonb;\n', '')
        .replace('    classroom.archived_at,\n    classroom.feature_visibility\n', '    classroom.archived_at\n')
        .replace('    v_archived_at,\n    v_feature_visibility\n', '    v_archived_at\n')
        .replace(predicate, '')
      ).toBe(definition(prior, name))
    })

    it('preserves signature, defaults, lock kind, security metadata, DTO and service-only ACL', () => {
      const body = definition(migration(), name)
      const old = definition(prior, name)
      expect(body.slice(0, body.indexOf('declare'))).toBe(old.slice(0, old.indexOf('declare')))
      expect(body.match(/for (?:update|share) of classroom, assignment;/)?.[0]).toBe(old.match(/for (?:update|share) of classroom, assignment;/)?.[0])
      expect(body.slice(body.indexOf('  perform 1\n  from public.classroom_enrollments'))).toBe(old.slice(old.indexOf('  perform 1\n  from public.classroom_enrollments')))
      expect(body).toContain("security definer\nset search_path = ''")
      expect(acl(migration(), name)).toBe(acl(prior, name))
    })
  })

  it('replaces only the four allocated complete RPCs in one forward transaction', () => {
    const sql = migration()
    expect(sql.match(/create or replace function /g)).toHaveLength(4)
    expect(sql).toMatch(/\nbegin;\s+create or replace function/)
    expect(sql).toMatch(/\ncommit;\s*$/)
    let outside = sql
    for (const name of names) outside = outside.replace(definition(sql, name), '').replace(acl(sql, name), '')
    expect(outside.replace(/--[^\n]*/g, '').replace(/\b(?:begin|commit);/g, '').trim()).toBe('')
    expect(sql).not.toMatch(/pg_get_functiondef|\bexecute\b\s+(?:format|replace)|\.role\b|\b(?:billing|plan|users)\b/i)
  })

  it('matches the 240 predicate and normalizer without text-to-boolean coercion', () => {
    const open = readFileSync('supabase/migrations/240_contextual_assignment_open_classwork.sql', 'utf8')
    expect(open).toContain(predicate)
    for (const name of names) {
      expect(definition(migration(), name)).toContain(predicate)
      expect(definition(migration(), name)).not.toMatch(/feature_visibility\s*->>\s*'classwork'|classwork[^\n]*::boolean/)
    }
    expect(normalizeClassroomFeatureVisibility({ classwork: false }).classwork).toBe(false)
    for (const value of [undefined, null, {}, { tests: false }, { classwork: true }, { classwork: null }, { classwork: 'false' }, { classwork: 0 }, { classwork: [] }, { classwork: {} }, false, 'false', 0, [], [{ classwork: false }]]) {
      expect(normalizeClassroomFeatureVisibility(value).classwork).toBe(true)
    }
  })

  it('uses required persisted due dates rather than relaxing the current Assignment schema', () => {
    const fixture = harness().split('insert into public.assignments ')[1]?.split('insert into public.assignment_submission_requirements ')[0] ?? ''
    expect(fixture.length > 0).toBe(true)
    expect(/', '', null,/.test(fixture)).toBe(false)
    expect(fixture.match(/clock_timestamp\(\) \+ interval '7 days'/g)).toHaveLength(8)
  })

  it('preserves the immutable activation guard while allowing a fresh rollback-only capture fixture', () => {
    const source = harness()
    expect(source).toContain('guard_pal_signal_activation')
    expect(source).toContain('set enabled = v_mode, activated_at = case when v_mode then coalesce(activated_at,')
    expect(source).toContain("date_trunc('week', clock_timestamp() at time zone 'America/Toronto') at time zone 'America/Toronto')")
    expect(source).toContain('else activated_at end')
  })

  it('provides a bounded, collision-guarded canonical-local rollback harness', () => {
    const source = harness()
    expect(source).toContain('name=^supabase_db_pika$')
    expect(source).toContain("!= 'supabase_db_pika'")
    expect(source).toContain('Migration 241 is required; this harness never applies it')
    expect(source).toContain("array['search_path=\"\"']::text[]")
    expect(source).toContain("v_owner <> 'postgres'")
    expect(source).toContain("has_function_privilege('anon'")
    expect(source).toContain("has_function_privilege('authenticated'")
    expect(source).toContain("has_function_privilege('service_role'")
    expect(source).toContain('sc241 fixture namespace collision')
    expect(source).toContain("set local lock_timeout = '3s'")
    expect(source).toContain("set local statement_timeout = '30s'")
    expect(source).toContain('guard_pal_membership_evidence')
    expect(source).toMatch(/\nbegin;[\s\S]*\nrollback;\nSQL\s*$/)
    expect(source).not.toMatch(/\bcommit;|\bdelete\s+from|\btruncate\b|\balter\s+table|\bdisable\s+trigger|session_replication_role|supabase\s+(?:db|migration)|curl|fetch\(/i)
    expect(source).not.toMatch(/create\s+(?:or\s+replace\s+)?(?:function|table)|\.env|PGHOST|DATABASE_URL/i)
    for (const name of names) expect(source).toContain(`public.${name}(`)
    for (const table of ['assignment_docs', 'assignment_doc_history', 'assignment_doc_save_operations', 'metric_session_id', 'assignment_submission_artifacts', 'assignment_submission_requirements', 'pal_event_outbox', 'pal_membership_outbox', 'pal_membership_generations']) expect(source).toContain(table)
    for (const evidence of [
      'Hidden missing/existing document changed whole-row evidence',
      'Owner denial lost precedence over hidden/archive/draft',
      'Visible mixed-role save/submit/unsubmit/preflight contract failed',
      'Visible legacy-Pal control did not enqueue exactly one valid event',
      'Visible membership-Pal completion control failed',
      'Default-visible normalization value rejected',
      'Expected missing/archive/draft/scheduled concealment',
      'Expected outsider denial',
      'assignment_doc_revision_required',
      'assignment_doc_revision_conflict',
      'payload = v_event',
      'v_before is distinct from',
    ]) expect(source).toContain(evidence)
  })
})
