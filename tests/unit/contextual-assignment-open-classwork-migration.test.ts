import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeClassroomFeatureVisibility } from '@/lib/classroom-feature-visibility'

const prior = readFileSync('supabase/migrations/214_contextual_assignment_owner_precedence.sql', 'utf8')
const migration = () => readFileSync('supabase/migrations/240_contextual_assignment_open_classwork.sql', 'utf8')
const harness = () => readFileSync('scripts/check-contextual-assignment-open-classwork-database.sh', 'utf8')

function definition(source: string): string {
  const found = source.match(/create or replace function public\.open_assignment_doc_for_member_v1\([\s\S]*?\$function\$;/)
  if (!found) throw new Error('Missing complete contextual Assignment open definition')
  return found[0]
}

describe('contextual Assignment open Classwork visibility', () => {
  it('records the existing 214 gap: locked parent evidence lacks Classwork visibility', () => {
    const body = definition(prior)
    expect(body).toContain('for update of classroom, assignment;')
    expect(body).toContain('if v_teacher_id = p_actor_id then')
    expect(body).toContain('insert into public.assignment_docs')
    expect(body).not.toContain('feature_visibility')
    expect(body).not.toContain('classwork')
  })

  it('reads visibility under the existing parent locks and conceals before any document or Pal work', () => {
    const body = definition(migration())
    expect(body).toContain('classroom.feature_visibility')
    expect(body).toContain('v_feature_visibility jsonb;')
    const parentLock = body.indexOf('for update of classroom, assignment;')
    const owner = body.indexOf('if v_teacher_id = p_actor_id then')
    const hidden = body.indexOf("jsonb_typeof(v_feature_visibility) = 'object'")
    const membership = body.indexOf('from public.classroom_enrollments as enrollment')
    expect(parentLock).toBeGreaterThan(body.indexOf('classroom.feature_visibility'))
    expect(owner).toBeGreaterThan(parentLock)
    expect(hidden).toBeGreaterThan(owner)
    expect(membership).toBeGreaterThan(hidden)
    expect(body.slice(hidden, membership)).toContain("errcode = 'P0002', message = 'Assignment not found'")
    expect(body.slice(owner, hidden)).toContain("errcode = '42501', message = 'Forbidden'")
    for (const sideEffect of ['select document.*', 'insert into public.assignment_docs', 'update public.assignment_docs', 'private.enqueue_pal_event(']) {
      expect(body.indexOf(sideEffect)).toBeGreaterThan(membership)
    }
  })

  it('preserves the complete 214 definition after stripping only added visibility evidence and predicate', () => {
    const replacement = definition(migration())
      .replace('  v_feature_visibility jsonb;\n', '')
      .replace('    classroom.archived_at,\n    classroom.feature_visibility\n', '    classroom.archived_at\n')
      .replace('    v_archived_at,\n    v_feature_visibility\n', '    v_archived_at\n')
      .replace(
        "    -- Match normalization: only an object with JSON boolean false hides Classwork.\n" +
        "    or (jsonb_typeof(v_feature_visibility) = 'object'\n" +
        "      and v_feature_visibility->'classwork' = 'false'::jsonb)\n",
        '',
      )
    expect(replacement).toBe(definition(prior))
  })

  it('replaces exactly one function transactionally with the same service-only ACL', () => {
    const sql = migration()
    expect(sql.match(/create or replace function /g)).toHaveLength(1)
    expect(sql).toMatch(/\nbegin;\s+create or replace function/)
    expect(sql).toMatch(/\ncommit;\s*$/)
    expect(sql).toContain('security definer\nset search_path = \'\'')
    const acl = (source: string) => source.match(/revoke all on function public\.open_assignment_doc_for_member_v1\([^;]+;\s+grant execute on function public\.open_assignment_doc_for_member_v1\([^;]+;/)?.[0]
    expect(acl(sql)).toBeDefined()
    expect(acl(sql)).toBe(acl(prior))
    const outsideFunction = sql.replace(definition(sql), '').replace(/--[^\n]*/g, '')
    expect(outsideFunction).not.toMatch(/\b(insert|update|delete|truncate|alter|drop|create)\b/i)
    expect(sql).not.toMatch(/pg_get_functiondef|\bexecute\b\s+(?:format|replace)|\b(?:users|plan|billing)\b|\.role\b/i)
  })

  it('uses the current normalizer contract, including default-visible malformed values', () => {
    const body = definition(migration())
    expect(body).toContain("or (jsonb_typeof(v_feature_visibility) = 'object'\n      and v_feature_visibility->'classwork' = 'false'::jsonb)")
    expect(body).not.toMatch(/feature_visibility\s*->>\s*'classwork'|classwork[^\n]*::boolean/)
    expect(normalizeClassroomFeatureVisibility({ classwork: false }).classwork).toBe(false)
    for (const value of [undefined, null, {}, { classwork: true }, { classwork: null }, { classwork: 'false' }, { classwork: 0 }, { classwork: [] }, { classwork: {} }, false, 'false', 0, [], [{ classwork: false }]]) {
      expect(normalizeClassroomFeatureVisibility(value).classwork).toBe(true)
    }
  })

  it('provides a collision-guarded local rollback harness without migration or cleanup authority', () => {
    const source = harness()
    expect(source).toContain("name=^supabase_db_pika$")
    expect(source).toContain("!= 'supabase_db_pika'")
    expect(source).toContain('Migration 240 is required; this harness never applies it')
    expect(source).toContain("array['search_path=\"\"']::text[]")
    expect(source).toContain("v_owner <> 'postgres'")
    expect(source).toContain("has_function_privilege('anon'")
    expect(source).toContain("has_function_privilege('authenticated'")
    expect(source).toContain("has_function_privilege('service_role'")
    expect(source).toContain('c240 fixture namespace collision')
    expect(source).toContain('guard_pal_membership_evidence')
    expect(source).toMatch(/\nbegin;[\s\S]*\nrollback;\nSQL\s*$/)
    expect(source).not.toMatch(/\bcommit;|\bdelete\s+from|\btruncate\b|\balter\s+table|\bdisable\s+trigger|session_replication_role|supabase\s+(?:db|migration)|curl|fetch\(/i)
    for (const evidence of [
      'Hidden missing-document open changed document, history or Pal evidence',
      'Hidden existing-document open changed document, history or Pal evidence',
      'Owner denial lost precedence over hidden Classwork',
      'Visible teacher-valued and student-valued members must both open',
      'Default-visible normalization value rejected',
      'Expected archived/draft/scheduled concealment',
      'Expected outsider denial',
      'private.pal_membership_outbox',
      'Visible legacy-Pal control did not enqueue exactly one valid event',
      'payload = v_event',
      'v_docs_before is distinct from',
      'v_history_before is distinct from',
      'v_outbox_before is distinct from',
    ]) expect(source).toContain(evidence)
  })
})
