import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/214_contextual_assignment_owner_precedence.sql', 'utf8')
const definitions = [
  ['182_contextual_assignment_doc_open.sql', 'public.open_assignment_doc_for_member_v1'],
  ['185_contextual_assignment_doc_save_lock_order.sql', 'public.save_assignment_doc_for_member_v1'],
  ['186_contextual_assignment_doc_submission.sql', 'public.submit_assignment_doc_for_member_v1'],
  ['186_contextual_assignment_doc_submission.sql', 'public.unsubmit_assignment_doc_for_member_v1'],
  ['187_contextual_assignment_doc_submission_preflight.sql', 'public.prepare_assignment_doc_submission_for_member_v1'],
  ['188_contextual_assignment_doc_history_restore.sql', 'public.get_assignment_doc_history_for_actor_v1'],
  ['189_contextual_assignment_doc_restore_target_integrity.sql', 'public.restore_assignment_doc_for_member_v1'],
  ['190_contextual_assignment_artifacts.sql', 'private.lock_assignment_artifact_member_context_v1'],
] as const

function definition(source: string, name: string): string {
  const escaped = name.replaceAll('.', '\\.')
  const found = source.match(new RegExp(`create(?: or replace)? function ${escaped}\\([\\s\\S]*?\\$function\\$;`))
  if (!found) throw new Error(`Missing definition: ${name}`)
  return found[0].replace(/^create(?: or replace)? function/, 'create or replace function')
}

describe('contextual Assignment owner precedence', () => {
  it.each(definitions)('checks locked owner evidence in %s / %s before membership', (_file, name) => {
    const body = definition(sql, name)
    const parentLock = body.search(/for (?:share|update) of classroom, assignment;/)
    const ownerDenial = body.indexOf('if v_teacher_id = p_actor_id then')
    const enrollment = body.indexOf('from public.classroom_enrollments as enrollment')
    expect(parentLock).toBeGreaterThan(-1)
    expect(ownerDenial).toBeGreaterThan(parentLock)
    expect(enrollment).toBeGreaterThan(ownerDenial)
    expect(body.slice(ownerDenial)).toMatch(/^if v_teacher_id = p_actor_id then\s+raise exception using errcode = '42501', message = 'Forbidden';/)
    expect(body).toContain('classroom.teacher_id,')
    expect(body).toContain("set search_path = ''")
    expect(body).not.toMatch(/users|\.role\b/)
  })

  it.each(definitions)('preserves the complete prior transaction apart from owner rejection: %s / %s', (file, name) => {
    const original = definition(readFileSync(`supabase/migrations/${file}`, 'utf8'), name)
    let replacement = definition(sql, name).replace(
      / {2,4}-- Ownership takes precedence over historical self-enrollment\. The owner\n {2,4}-- value comes from the classroom row already locked above\.\n {2,4}if v_teacher_id = p_actor_id then\n {4,6}raise exception using errcode = '42501', message = 'Forbidden';\n {2,4}end if;\n\n/,
      '',
    )
    if (!name.includes('get_assignment_doc_history')) {
      replacement = replacement.replace('  v_teacher_id uuid;\n', '')
        .replace('    classroom.teacher_id,\n', '')
        .replace('    v_teacher_id,\n', '')
    }
    expect(replacement).toBe(original)
  })

  it('retains service-only public entrypoints and an uncallable private helper', () => {
    for (const [, name] of definitions) {
      const escaped = name.replaceAll('.', '\\.')
      expect(sql).toMatch(new RegExp(`revoke all on function ${escaped}\\([^;]+from public, anon, authenticated`))
      if (name.startsWith('public.')) {
        expect(sql).toMatch(new RegExp(`grant execute on function ${escaped}\\([^;]+to service_role`))
      } else {
        expect(sql).toMatch(new RegExp(`revoke all on function ${escaped}\\([^;]+from public, anon, authenticated, service_role`))
        expect(sql).not.toMatch(new RegExp(`grant execute on function ${escaped}`))
      }
    }
    expect(sql.match(/create or replace function /g)).toHaveLength(8)
    expect(sql).not.toMatch(/\bexecute\s+(?:format|replace)|pg_get_functiondef|alter table|drop function/i)
  })

  it('keeps owner history inspection and artifact/repository callers on their existing branches', () => {
    const history = definition(sql, 'public.get_assignment_doc_history_for_actor_v1')
    expect(history).toMatch(/if not p_member_only and v_teacher_id = p_actor_id then\s+v_access_mode := 'owner';\s+else/)
    const artifacts = readFileSync('supabase/migrations/190_contextual_assignment_artifacts.sql', 'utf8')
    for (const method of ['prepare', 'upsert', 'delete']) {
      expect(definition(artifacts, `public.${method}_assignment_artifact_for_member_v1`))
        .toContain('from private.lock_assignment_artifact_member_context_v1(')
    }
    expect(sql).not.toContain('function public.save_assignment_repo_target_for_owner_v1(')
  })
})
