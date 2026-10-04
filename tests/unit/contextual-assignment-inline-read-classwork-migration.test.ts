import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeClassroomFeatureVisibility } from '@/lib/classroom-feature-visibility'

const name = 'public.read_assignment_inline_image_for_context_v1'
const signature = `${name}(uuid, uuid, uuid, uuid)`
const prior = readFileSync('supabase/migrations/213_contextual_assignment_inline_images.sql', 'utf8')
const migration = () => readFileSync('supabase/migrations/243_contextual_assignment_inline_read_classwork.sql', 'utf8')
const harness = () => readFileSync('scripts/check-contextual-assignment-inline-read-classwork-database.sh', 'utf8')
const concealment = "      -- Match normalization: only an object with JSON boolean false hides Classwork.\n" +
  "      or (jsonb_typeof(v_feature_visibility) = 'object'\n" +
  "        and v_feature_visibility->'classwork' = 'false'::jsonb)\n"
const acl = `revoke all on function ${signature}\n  from public, anon, authenticated;\ngrant execute on function ${signature}\n  to service_role;`

function body(source: string): string {
  const definition = source.match(/create (?:or replace )?function public\.read_assignment_inline_image_for_context_v1\([\s\S]*?\$function\$;/)?.[0]
  if (!definition) throw new Error('Missing complete inline-read definition')
  return definition.replace('create function ', 'create or replace function ')
}

describe('contextual Assignment inline-read locked Classwork', () => {
  it('records the missing concealment in the sole latest definition', () => {
    expect(prior.match(/function public\.read_assignment_inline_image_for_context_v1\(/g)).toHaveLength(1)
    expect(body(prior)).toContain('for share of classroom, assignment;')
    expect(body(prior)).toContain('if not v_is_owner then')
    expect(body(prior)).not.toContain('feature_visibility')
  })

  it('reads visibility under the existing lock and conceals only the nonowner branch', () => {
    const definition = body(migration())
    const lock = definition.indexOf('for share of classroom, assignment;')
    const owner = definition.indexOf('v_is_owner := v_teacher_id = p_actor_id;')
    const hidden = definition.indexOf(concealment)
    const member = definition.indexOf('from public.classroom_enrollments as enrollment')
    expect(definition).toContain('  v_feature_visibility jsonb;')
    expect(definition).toContain('assignment.released_at, classroom.archived_at, classroom.feature_visibility')
    expect(definition).toContain('v_assignment_released_at, v_archived_at, v_feature_visibility')
    expect(lock).toBeGreaterThan(definition.indexOf('classroom.feature_visibility'))
    expect(owner).toBeGreaterThan(lock)
    expect(hidden).toBeGreaterThan(definition.indexOf('if not v_is_owner then'))
    expect(hidden).toBeLessThan(member)
    expect(definition.slice(hidden, member)).toContain("return jsonb_build_object('ok', false, 'status', 404, 'error', 'Image not found');")
    expect(definition.slice(owner, member)).toMatch(/if not v_is_owner then[\s\S]+end if;\n  end if;/)
  })

  it('preserves the entire latest body after stripping only the three visibility additions', () => {
    const definition = body(migration())
    for (const addition of ['  v_feature_visibility jsonb;\n', ', classroom.feature_visibility\n', ', v_feature_visibility\n', concealment]) expect(definition.split(addition)).toHaveLength(2)
    expect(definition.replace('  v_feature_visibility jsonb;\n', '')
      .replace(', classroom.feature_visibility\n', '\n')
      .replace(', v_feature_visibility\n', '\n')
      .replace(concealment, '')).toBe(body(prior))
  })

  it('preserves every binding, error, lock, status and DTO contract', () => {
    const definition = body(migration())
    expect(definition.slice(0, definition.indexOf('declare'))).toBe(body(prior).slice(0, body(prior).indexOf('declare')))
    for (const evidence of [
      "'assignment_submission:'", "v_initial_assignment_id::text || ':' || v_subject_id::text",
      "'pika-classroom-operation:'", 'private.try_lock_classroom_membership_change',
      'v_assignment_classroom_id is distinct from v_initial_classroom_id',
      "errcode = '40001', message = 'Assignment classroom changed'",
      "errcode = 'P0002', message = 'Assignment document not found'",
      'v_current_assignment_id is distinct from v_initial_assignment_id',
      'v_current_subject_id is distinct from v_subject_id',
      'p_actor_id is distinct from v_subject_id', 'enrollment.student_id = v_subject_id',
      "v_object.storage_bucket <> 'submission-images'", "v_object.purpose <> 'student_inline_image'",
      'v_object.classroom_id is distinct from v_assignment_classroom_id',
      'v_object.created_by_user_id is distinct from v_subject_id',
      'v_object.data_subject_user_id is distinct from v_subject_id',
      "v_object.resource_type <> 'assignment_doc'", 'v_object.resource_id is distinct from p_assignment_doc_id',
      "(v_is_owner and v_object.status <> 'ready')", "v_object.status not in ('verified', 'ready')",
      'v_object.created_by_user_id is distinct from p_actor_id',
    ]) expect(definition).toContain(evidence)
    expect(definition.match(/return jsonb_build_object\('ok', false, 'status', 404, 'error', 'Image not found'\);/g)).toHaveLength(4)
    expect(definition).toContain("security definer\nset search_path = ''")
    expect(definition).not.toMatch(/\.role\b|\bis_submitted\b|\b(?:insert|update|delete)\b|lock_managed_storage_protocol/)
  })

  it('contains only one explicit replacement and equivalent sole service-role ACL', () => {
    const sql = migration()
    expect(sql.match(/create or replace function /g)).toHaveLength(1)
    expect(sql).toContain(acl)
    expect(prior).toContain(`  ${signature}\n  from public, anon, authenticated;`)
    expect(prior).toContain(`  ${signature}\n  to service_role;`)
    expect(sql.replace(body(sql), '').replace(acl, '').replace(/--[^\n]*/g, '').replace(/\b(?:begin|commit);/g, '').trim()).toBe('')
    expect(sql).toMatch(/\nbegin;\s+create or replace function/)
    expect(sql).toMatch(/\ncommit;\s*$/)
    expect(sql).not.toMatch(/pg_get_functiondef|reserve_assignment_inline|finalize_assignment_inline|private\.lock_assignment|\b(?:table|index|policy|role|billing|plan)\b/i)
  })

  it('matches default-visible normalization without claiming forbidden persisted shapes', () => {
    expect(normalizeClassroomFeatureVisibility({ classwork: false }).classwork).toBe(false)
    for (const value of [null, {}, { tests: false }, { classwork: true }, { classwork: null }, { classwork: 'false' }, false, [], { classwork: 0 }]) expect(normalizeClassroomFeatureVisibility(value).classwork).toBe(true)
  })

  it('prepares one exact canonical rollback transaction without cleanup or live services', () => {
    const source = harness()
    expect(source).toContain('name=^supabase_db_pika$')
    expect(source).toContain("!= 'supabase_db_pika'")
    expect(source).toContain('Migration 243 is required; this harness never applies it')
    expect(source).toContain('sc243 fixture namespace collision')
    expect(source).toContain("set local lock_timeout = '3s'")
    expect(source).toContain("set local statement_timeout = '30s'")
    expect(source).toMatch(/\nbegin;[\s\S]*\nrollback;\nSQL\s*$/)
    expect(source).not.toMatch(/\bcommit;|\bdelete\s+from|\btruncate\b|\balter\s+table|\bdisable\s+trigger|session_replication_role|supabase\s+(?:db|migration)|curl|fetch\(|\.env|DATABASE_URL|update\s+public\.classroom_enrollments/i)
    expect(source).not.toMatch(/(?:insert\s+into|update)\s+(?:private\.(?:pal_membership_settings|pal_classroom_signal_settings)|public\.managed_storage_settings|storage\.buckets|cron\.job)|create\s+policy/i)
    expect(source).toContain('No same-actor post-revocation transition or concurrency proof')
    expect(source).toContain('No Storage API/bytes')
  })

  it('preserves NULL-scope retained evidence and parenthesizes CASE comparisons', () => {
    const source = harness()
    expect(source.match(/private\.pal_membership_generations t where not exists \(select 1 from public\.classrooms c cross join public\.users a/g)).toHaveLength(2)
    expect(source).not.toMatch(/scope_digest\s+not\s+in|is distinct from\s+case\b|(?:<>|=)\s+case\b/i)
    expect(source).toContain("('purged'::text, null::text)")
    expect(source).toContain("v_retained is distinct from (case when v_fixture_exists")
    for (const evidence of ['guard_pal_membership_evidence', 'guard_pal_signal_activation', 'private.pal_membership_settings', 'private.pal_classroom_signal_settings', 'cron.job', 'classroom_archive_resource_contract', 'classroom_gradex_resource_contract', 'storage.buckets', 'pg_policy', 'pika.sc243_baseline']) expect(source).toContain(evidence)
  })

  it('prepares nonvacuous verified/ready controls, exact denials and whole-row preservation', () => {
    const source = harness()
    for (const evidence of [
      'public.read_assignment_inline_image_for_context_v1(', 'public.begin_managed_storage_upload(',
      'public.verify_managed_storage_upload(', 'public.managed_storage_mark_ready(',
      'insert into storage.objects (id, bucket_id, name)', "'sc243-2@example.invalid', 'teacher'",
      "'sc243-3@example.invalid', 'student'", "if current_user <> 'service_role'",
      'Hidden inline read changed whole-row evidence', 'Owner hidden inspection failed',
      'Visible verified learner control failed', 'Visible ready owner control failed',
      'Image not found', 'Assignment classroom changed', 'Assignment document not found',
      'wrong_purpose', 'wrong_creator', 'wrong_subject', 'wrong_resource', 'wrong_classroom',
      'reserved', 'verified', 'ready', 'v_before is distinct from',
    ]) expect(source).toContain(evidence)
    expect(source.match(/clock_timestamp\(\) \+ interval '7 days'/g)).toHaveLength(5)
  })
})
