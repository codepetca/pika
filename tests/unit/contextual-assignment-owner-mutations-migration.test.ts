import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = () => readFileSync(
  'supabase/migrations/191_contextual_assignment_owner_mutations.sql',
  'utf8',
)

function functionBody(name: string): string {
  return migration().split(`function public.${name}(`)[1]?.split('$function$;')[0] ?? ''
}

describe('contextual assignment owner mutations migration', () => {
  it('adds four service-only owner mutation boundaries with fixed search paths', () => {
    const sql = migration()
    for (const name of [
      'update_assignment_for_owner_v1',
      'release_assignment_for_owner_v1',
      'delete_assignment_for_owner_v1',
      'discard_pristine_assignment_draft_for_owner_v1',
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
    expect(sql.match(/security definer/g)).toHaveLength(4)
    expect(sql.match(/set search_path = ''/g)).toHaveLength(5)
    expect(sql).toMatch(/revoke all on function private\.lock_assignment_owner_mutation_context_v1\([^;]+service_role/s)
  })

  it('locks the assignment mutation fence before the Classroom operation and parent rows', () => {
    const body = migration()
      .split('function private.lock_assignment_owner_mutation_context_v1(')[1]
      ?.split('$function$;')[0] ?? ''
    const submissionLock = body.indexOf("'assignment_submission:'")
    const initialBinding = body.indexOf('select assignment.classroom_id')
    const classroomLock = body.indexOf("'pika-classroom-operation:'")
    const parentLocks = body.indexOf('for update of classroom, assignment')
    const ownerCheck = body.indexOf('v_owner_id is distinct from p_actor_id')

    expect(submissionLock).toBeGreaterThan(-1)
    expect(submissionLock).toBeLessThan(initialBinding)
    expect(initialBinding).toBeLessThan(classroomLock)
    expect(classroomLock).toBeLessThan(parentLocks)
    expect(parentLocks).toBeLessThan(ownerCheck)
    expect(body).toContain('v_assignment.classroom_id is distinct from v_initial_classroom_id')
    expect(body).toContain('v_archived_at is not null')
  })

  it('restricts update keys and rechecks schedule transitions under the lock', () => {
    const body = functionBody('update_assignment_for_owner_v1')
    expect(body).toContain("'title', 'instructions_markdown', 'description', 'rich_instructions'")
    expect(body).toContain("'due_at', 'is_draft', 'released_at'")
    expect(body).toContain('v_existing_live')
    expect(body).toContain('v_effective_due_at < v_effective_released_at')
    expect(body).toContain('public.update_assignment_with_submission_requirements_atomic')
  })

  it('keeps release, delete, and pristine discard inside the owner lock', () => {
    expect(functionBody('release_assignment_for_owner_v1'))
      .toContain('private.lock_assignment_owner_mutation_context_v1')
    expect(functionBody('delete_assignment_for_owner_v1'))
      .toContain('private.lock_assignment_owner_mutation_context_v1')
    expect(functionBody('discard_pristine_assignment_draft_for_owner_v1'))
      .toContain('public.discard_pristine_assignment_draft_atomic')
  })

  it('keeps rollback-only database behavior in the architecture lane', () => {
    const behavior = readFileSync(
      'scripts/check-contextual-assignment-owner-mutations-database.sh',
      'utf8',
    )
    const concurrency = readFileSync(
      'scripts/check-contextual-assignment-owner-mutations-concurrency.mjs',
      'utf8',
    )
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
    expect(behavior).toContain('Migration 191 is required; this harness never applies it')
    expect(behavior).toContain('Student-valued owner update returned invalid evidence')
    expect(behavior).toContain('Teacher-valued owner release returned invalid evidence')
    expect(behavior).toContain('Expected unrelated user owner-mutation denial')
    expect(behavior).toContain('Submitted requirement mutation did not fail closed')
    expect(behavior).toContain('rollback;')
    expect(behavior).not.toMatch(/supabase\s+(?:db\s+push|migration\s+up|db\s+reset)/)
    expect(concurrency).toContain('Migration 191 must already be applied')
    expect(concurrency).toContain('Passed: owner_transfer_wins_assignment_mutation')
    expect(concurrency).toContain('Passed: assignment_mutation_wins_archive')
    expect(workflow).toContain('bash scripts/check-contextual-assignment-owner-mutations-database.sh')
    expect(workflow).toContain('node scripts/check-contextual-assignment-owner-mutations-concurrency.mjs')
  })
})
