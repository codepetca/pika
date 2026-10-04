import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeClassroomFeatureVisibility } from '@/lib/classroom-feature-visibility'

const migration = () => readFileSync('supabase/migrations/242_contextual_assignment_member_supplement_visibility.sql', 'utf8')
const harness = () => readFileSync('scripts/check-contextual-assignment-member-supplement-visibility-database.sh', 'utf8')
const contracts = [
  { name: 'public.get_assignment_doc_history_for_actor_v1', prior: '214_contextual_assignment_owner_precedence', lock: 'share', security: 'definer', indent: '      ', effect: 'select doc.*' },
  { name: 'public.restore_assignment_doc_for_member_v1', prior: '214_contextual_assignment_owner_precedence', lock: 'share', security: 'definer', indent: '    ', effect: 'select doc.*' },
  { name: 'private.lock_assignment_artifact_member_context_v1', prior: '214_contextual_assignment_owner_precedence', lock: 'update', security: 'invoker', indent: '    ', effect: 'select requirement_row.*' },
  { name: 'private.lock_assignment_inline_image_member_context_v1', prior: '213_contextual_assignment_inline_images', lock: 'update', security: 'invoker', indent: '    ', effect: 'select document.* into v_doc' },
] as const

function definition(source: string, name: string): string {
  const match = source.match(new RegExp(`create (?:or replace )?function ${name.replaceAll('.', '\\.')}\\([\\s\\S]*?\\$function\\$;`))
  if (!match) throw new Error(`Missing complete definition: ${name}`)
  return match[0].replace('create function ', 'create or replace function ')
}

function predicate(indent: string): string {
  return `${indent}-- Match normalization: only an object with JSON boolean false hides Classwork.\n` +
    `${indent}or (jsonb_typeof(v_feature_visibility) = 'object'\n` +
    `${indent}  and v_feature_visibility->'classwork' = 'false'::jsonb)\n`
}

function acl(source: string, name: string): string {
  const qualified = name.replaceAll('.', '\\.')
  const match = source.match(new RegExp(`revoke all on function ${qualified}\\([^;]+;${name.startsWith('public.') ? `\\s+grant execute on function ${qualified}\\([^;]+;` : ''}`))
  if (!match) throw new Error(`Missing ACL: ${name}`)
  return match[0]
}

describe('contextual Assignment member supplement visibility', () => {
  describe.each(contracts)('$name', (contract) => {
    const prior = readFileSync(`supabase/migrations/${contract.prior}.sql`, 'utf8')
    it('records the gap in the latest locked definition', () => {
      const old = definition(prior, contract.name)
      expect(old).toContain(`for ${contract.lock} of classroom, assignment;`)
      expect(old).toContain('if v_teacher_id = p_actor_id then')
      expect(old).not.toContain('feature_visibility')
    })
    it('conceals from locked evidence after owner precedence and before effects', () => {
      const body = definition(migration(), contract.name)
      const lock = body.indexOf(`for ${contract.lock} of classroom, assignment;`)
      const owner = body.indexOf('if v_teacher_id = p_actor_id then')
      const hidden = body.indexOf(predicate(contract.indent))
      const enrollment = body.indexOf('from public.classroom_enrollments as enrollment')
      expect(body).toContain('  v_feature_visibility jsonb;')
      expect(lock).toBeGreaterThan(body.indexOf('classroom.feature_visibility'))
      expect(owner).toBeGreaterThan(lock)
      expect(hidden).toBeGreaterThan(owner)
      expect(enrollment).toBeGreaterThan(hidden)
      expect(body.slice(owner, hidden)).toContain("errcode = '42501', message = 'Forbidden'")
      expect(body.slice(hidden, enrollment)).toContain("errcode = 'P0002', message = 'Assignment not found'")
      expect(body.indexOf(contract.effect)).toBeGreaterThan(enrollment)
    })
    it('preserves the entire latest body after stripping only allowed visibility additions', () => {
      const body = definition(migration(), contract.name)
      for (const addition of ['  v_feature_visibility jsonb;\n', '    classroom.feature_visibility\n', '    v_feature_visibility\n', predicate(contract.indent)]) expect(body.split(addition)).toHaveLength(2)
      expect(body.replace('  v_feature_visibility jsonb;\n', '')
        .replace('    classroom.archived_at,\n    classroom.feature_visibility\n', '    classroom.archived_at\n')
        .replace('    v_archived_at,\n    v_feature_visibility\n', '    v_archived_at\n')
        .replace(predicate(contract.indent), '')).toBe(definition(prior, contract.name))
    })
    it('preserves signatures, defaults, security mode and complete ACL', () => {
      const body = definition(migration(), contract.name)
      const old = definition(prior, contract.name)
      expect(body.slice(0, body.indexOf('declare'))).toBe(old.slice(0, old.indexOf('declare')))
      expect(body).toContain(`security ${contract.security}\nset search_path = ''`)
      expect(acl(migration(), contract.name)).toBe(acl(prior, contract.name))
      if (contract.name.startsWith('private.')) expect(acl(migration(), contract.name)).toContain('from public, anon, authenticated, service_role;')
    })
  })

  it('keeps the history owner branch outside learner concealment', () => {
    const body = definition(migration(), contracts[0].name)
    expect(body).toContain("if not p_member_only and v_teacher_id = p_actor_id then\n    v_access_mode := 'owner';\n  else")
    expect(body.indexOf(predicate('      '))).toBeGreaterThan(body.indexOf("v_access_mode := 'member';"))
    expect(body).toContain("p_requested_student_id uuid default null,\n  p_member_only boolean default false")
  })

  it('contains only the four explicit forward replacements and unchanged ACLs', () => {
    const sql = migration()
    expect(sql.match(/create or replace function /g)).toHaveLength(4)
    expect(sql).toMatch(/\nbegin;\s+create or replace function/)
    expect(sql).toMatch(/\ncommit;\s*$/)
    let outside = sql
    for (const contract of contracts) outside = outside.replace(definition(sql, contract.name), '').replace(acl(sql, contract.name), '')
    expect(outside.replace(/--[^\n]*/g, '').replace(/\b(?:begin|commit);/g, '').trim()).toBe('')
    expect(sql).not.toMatch(/pg_get_functiondef|\bexecute\s+(?:format|replace)|\.role\b|\b(?:users|billing|plan)\b/i)
    for (const contract of contracts) expect(sql).toContain(predicate(contract.indent))
    expect(normalizeClassroomFeatureVisibility({ classwork: false }).classwork).toBe(false)
    for (const value of [null, {}, { tests: false }, { classwork: null }, { classwork: 'false' }, false, [], { classwork: true }]) expect(normalizeClassroomFeatureVisibility(value).classwork).toBe(true)
  })

  it('prepares exact-local rollback evidence without applying or broadening cleanup', () => {
    const source = harness()
    expect(source).toContain('name=^supabase_db_pika$')
    expect(source).toContain("!= 'supabase_db_pika'")
    expect(source).toContain('Migration 242 is required; this harness never applies it')
    expect(source).toContain('sc242 fixture namespace collision')
    expect(source).toContain("set local lock_timeout = '3s'")
    expect(source).toContain("set local statement_timeout = '30s'")
    expect(source).toMatch(/\nbegin;[\s\S]*\nrollback;\nSQL\s*$/)
    expect(source).not.toMatch(/\bcommit;|\bdelete\s+from|\btruncate\b|\balter\s+table|\bdisable\s+trigger|session_replication_role|supabase\s+(?:db|migration)|curl|fetch\(|\.env|DATABASE_URL/i)
    for (const name of ['get_assignment_doc_history_for_actor_v1', 'restore_assignment_doc_for_member_v1', 'prepare_assignment_artifact_for_member_v1', 'upsert_assignment_artifact_for_member_v1', 'delete_assignment_artifact_for_member_v1', 'reserve_assignment_inline_image_for_member_v1', 'finalize_assignment_inline_image_for_member_v1']) expect(source).toContain(`public.${name}(`)
    for (const evidence of ['guard_pal_membership_evidence', 'pal_membership_generations', 'pal_membership_settings', 'pal_classroom_signal_settings', 'cron.job', 'managed_storage_objects', 'assignment_doc_history', 'assignment_doc_save_operations', 'assignment_submission_artifacts', 'Hidden supplement changed whole-row evidence', 'Owner history lost hidden access', 'Owner member-only denial lost precedence', 'Visible exact history restoration failed', 'Visible artifact control failed', 'Visible inline control failed', 'v_before is distinct from']) expect(source).toContain(evidence)
  })

  it('keeps global activation, Storage ACLs and membership lifecycle out of the fixture', () => {
    const source = harness()
    expect(source).not.toMatch(/(?:insert\s+into|update)\s+(?:private\.(?:pal_membership_settings|pal_classroom_signal_settings)|public\.managed_storage_settings|storage\.buckets|cron\.job)|create\s+policy|managed_storage_mark_ready|update\s+public\.classroom_enrollments/i)
    expect(source).toContain('No same-actor post-revocation transition/concurrency is claimed')
    for (const evidence of ['public.classroom_archive_resource_contract', 'public.classroom_gradex_resource_contract', 'storage.buckets', 'pg_policy', 'pika.sc242_baseline']) expect(source).toContain(evidence)
    expect(source.match(/insert into storage\.objects /g)).toHaveLength(2)
    expect(source).toContain("v_path := 'sc242/' || v_doc.id::text || '/existing.png'")
    expect(source).toContain("insert into storage.objects (id,bucket_id,name) values(v_object,'submission-images',v_path)")
  })

  it('retains null-scope purged generations in both unrelated-evidence snapshots', () => {
    const source = harness()
    const exclusion = "from private.pal_membership_generations t where not exists (select 1 from public.classrooms c cross join public.users a where c.id::text like 'c242%' and a.id::text like 'c242%' and t.scope_digest = private.pal_membership_scope(c.id, a.id))"
    expect(source.split(exclusion)).toHaveLength(3)
    expect(source).not.toContain('where scope_digest not in')
    expect(source).toContain('Retained purged generation disappeared from unrelated-evidence snapshot')
    expect(source).toContain("('purged'::text, null::text)")
    expect(source).toContain('array[false, true]')
  })

  it('uses meaningful denied and visible evidence for both historical role labels', () => {
    const source = harness()
    expect(source).toContain("'sc242-2@example.invalid', 'teacher'")
    expect(source).toContain("'sc242-3@example.invalid', 'student'")
    expect(source).toContain("array['hidden', 'visible']")
    expect(source).toContain("array['history','restore','prepare','upsert','delete','reserve','finalize']")
    expect(source).toContain("if current_user <> 'service_role'")
    expect(source).toContain("v_result->'history_entry'->>'trigger' is distinct from 'submit'")
    expect(source).toContain("if v_ledger_count = 0 then raise exception 'Save-ledger fixture is vacuous'")
    expect(source).toContain("status='reserved'")
    expect(source).toContain("is distinct from 'verified'")
    expect(source).toContain("'assignment_doc_revision_conflict'")
    expect(source).toContain("'Assignment restore content does not match history target'")
    expect(source).toContain("'Assignment document not found'")
    expect(source.match(/clock_timestamp\(\) \+ interval '7 days'/g)).toHaveLength(7)
  })
})
