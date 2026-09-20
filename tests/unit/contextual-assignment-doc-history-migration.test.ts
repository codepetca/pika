import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const foundationMigration = () => readFileSync(
  'supabase/migrations/188_contextual_assignment_doc_history_restore.sql',
  'utf8',
)
const integrityMigration = () => readFileSync(
  'supabase/migrations/189_contextual_assignment_doc_restore_target_integrity.sql',
  'utf8',
)

function functionBody(name: string): string {
  const matches = [...`${foundationMigration()}\n${integrityMigration()}`.matchAll(
    new RegExp(
      `create(?: or replace)? function public\\.${name}\\([\\s\\S]*?as \\$function\\$([\\s\\S]*?)\\$function\\$;`,
      'g',
    ),
  )]
  return matches.at(-1)?.[1] ?? ''
}

describe('contextual assignment document history migration', () => {
  it('adds service-only history and restore boundaries with hardened metadata', () => {
    const sql = foundationMigration()
    for (const name of [
      'get_assignment_doc_history_for_actor_v1',
      'restore_assignment_doc_for_member_v1',
    ]) {
      expect(sql).toContain(`function public.${name}(`)
      expect(sql).toMatch(new RegExp(
        `revoke all on function public\\.${name}\\([^;]+from public, anon, authenticated`,
        's',
      ))
      expect(sql).toMatch(new RegExp(
        `grant execute on function public\\.${name}\\([^;]+to service_role`,
        's',
      ))
    }
    expect(sql.match(/security definer/g)).toHaveLength(2)
    expect(sql.match(/set search_path = ''/g)).toHaveLength(2)
  })

  it('authorizes and binds owner/member history after the shared document and membership fences', () => {
    const body = functionBody('get_assignment_doc_history_for_actor_v1')
    const submissionLock = body.indexOf("'assignment_submission:'")
    const editorLock = body.indexOf("p_assignment_id::text || ':' || v_subject_id::text")
    const classroomLock = body.indexOf("'pika-classroom-operation:'")
    const membershipLock = body.indexOf('private.try_lock_classroom_membership_change')
    const parentLocks = body.indexOf('for share of classroom, assignment')
    const accessMode = body.indexOf("v_access_mode := 'owner'", parentLocks)
    const visibility = body.indexOf('or v_assignment_is_draft', accessMode)
    const enrollment = body.indexOf('from public.classroom_enrollments as enrollment')
    const docRead = body.indexOf('from public.assignment_docs as doc')
    const historyRead = body.indexOf('from public.assignment_doc_history as history')

    expect(submissionLock).toBeGreaterThan(-1)
    expect(submissionLock).toBeLessThan(editorLock)
    expect(editorLock).toBeLessThan(classroomLock)
    expect(classroomLock).toBeLessThan(membershipLock)
    expect(membershipLock).toBeLessThan(parentLocks)
    expect(parentLocks).toBeLessThan(accessMode)
    expect(accessMode).toBeLessThan(visibility)
    expect(visibility).toBeLessThan(enrollment)
    expect(enrollment).toBeLessThan(docRead)
    expect(docRead).toBeLessThan(historyRead)
    expect(body).toContain('v_teacher_id is distinct from v_initial_teacher_id')
    expect(body).toContain("v_access_mode := 'member'")
    expect(body).toContain('v_archived_at is not null')
    expect(body).toContain('v_assignment_released_at > clock_timestamp()')
    expect(body).toContain("jsonb_agg(to_jsonb(history) order by history.created_at, history.id)")
  })

  it('rechecks member visibility and exact history ownership before atomic restore', () => {
    const body = functionBody('restore_assignment_doc_for_member_v1')
    const submissionLock = body.indexOf("'assignment_submission:'")
    const editorLock = body.indexOf("p_assignment_id::text || ':' || p_actor_id::text")
    const classroomLock = body.indexOf("'pika-classroom-operation:'")
    const membershipLock = body.indexOf('private.try_lock_classroom_membership_change')
    const parentLocks = body.indexOf('for share of classroom, assignment')
    const visibility = body.indexOf('or v_assignment_is_draft', parentLocks)
    const enrollment = body.indexOf('from public.classroom_enrollments as enrollment')
    const docLock = body.indexOf('from public.assignment_docs as doc')
    const historyLock = body.indexOf('from public.assignment_doc_history as history')
    const atomicSave = body.indexOf('public.save_assignment_doc_atomic(')

    expect(submissionLock).toBeLessThan(editorLock)
    expect(editorLock).toBeLessThan(classroomLock)
    expect(classroomLock).toBeLessThan(membershipLock)
    expect(membershipLock).toBeLessThan(parentLocks)
    expect(parentLocks).toBeLessThan(visibility)
    expect(visibility).toBeLessThan(enrollment)
    expect(enrollment).toBeLessThan(docLock)
    expect(docLock).toBeLessThan(historyLock)
    expect(historyLock).toBeLessThan(atomicSave)
    expect(body).toContain('history.id = p_history_id')
    expect(body).toContain('history.assignment_doc_id = v_doc.id')
    expect(body).toContain('private.apply_assignment_json_patch_v1(')
    expect(body).toContain('v_target_content is distinct from p_content')
    expect(body).toContain('v_target_content,\n    p_expected_updated_at')
    expect(body).toContain('v_target.word_count')
    expect(body).toContain('v_target.char_count')
    expect(body).toContain("'restore'")
    expect(body).toContain("v_result->'doc'->>'assignment_id' is distinct from p_assignment_id::text")
    expect(body).toContain("v_result->'doc'->>'student_id' is distinct from p_actor_id::text")
    expect(body).toContain("jsonb_build_object('classroom_id', v_assignment_classroom_id)")
  })

  it('supports only deterministic generated patch operations with strict JSON Pointer paths', () => {
    const sql = integrityMigration()
    expect(sql).toContain('function private.assignment_json_pointer_path_v1(p_pointer text)')
    expect(sql).toContain('function private.apply_assignment_json_patch_v1(')
    expect(sql).toContain("v_operation_name not in ('add', 'remove', 'replace')")
    expect(sql).toContain("p_pointer ~ '~([^01]|$)'")
    expect(sql).toContain('v_array_index > jsonb_array_length(v_parent)')
    expect(sql).toContain("v_document := jsonb_insert(v_document, v_path, v_operation->'value', false)")
    expect(sql).toContain('v_document := v_document #- v_path')
  })

  it('keeps rollback-only behavior and concurrent restore races in the architecture lane', () => {
    const behavior = readFileSync(
      'scripts/check-contextual-assignment-doc-history-database.sh',
      'utf8',
    )
    const concurrency = readFileSync(
      'scripts/check-contextual-assignment-doc-save-concurrency.mjs',
      'utf8',
    )
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
    expect(behavior).toContain('Migration 189 is required; this harness never applies it')
    expect(behavior).toContain('Mismatched restore content was not rejected atomically')
    expect(behavior).toContain('Patch target work')
    expect(behavior).toContain('Teacher-valued member history returned invalid evidence')
    expect(behavior).toContain('Student-valued owner draft history returned invalid evidence')
    expect(behavior).toContain('Removed member history disclosed state')
    expect(behavior).toContain('Removed member restored work')
    expect(behavior).toContain('rollback;')
    expect(behavior).not.toMatch(/supabase\s+(?:db\s+push|migration\s+up|db\s+reset)/)
    expect(concurrency).toContain("'removal_wins_contextual_restore'")
    expect(concurrency).toContain("console.log('Passed: contextual_restore_wins_removal')")
    expect(concurrency).toContain("console.log('Passed: contextual_restore_wins_save')")
    expect(concurrency).toContain("console.log('Passed: save_wins_contextual_restore')")
    expect(workflow).toContain('bash scripts/check-contextual-assignment-doc-history-database.sh')
    expect(workflow).toContain('node scripts/check-contextual-assignment-doc-save-concurrency.mjs')
  })
})
