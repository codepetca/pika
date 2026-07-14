import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/088_atomic_test_attempt_submit.sql'),
  'utf8',
)
const route = readFileSync(
  resolve(process.cwd(), 'src/app/api/student/tests/[id]/respond/route.ts'),
  'utf8',
)
const attemptRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/student/tests/[id]/attempt/route.ts'),
  'utf8',
)

describe('atomic test submit contract', () => {
  it('defines a service-role-only security-definer RPC with a fixed search path', () => {
    expect(migration).toContain('create or replace function public.submit_test_attempt_atomic(')
    expect(migration).toContain('security definer')
    expect(migration).toContain("set search_path = ''")
    expect(migration).toMatch(
      /revoke all on function public\.submit_test_attempt_atomic[\s\S]+from public, anon, authenticated;/,
    )
    expect(migration).toMatch(
      /grant execute on function public\.submit_test_attempt_atomic[\s\S]+to service_role;/,
    )
  })

  it('locks lifecycle inputs and persists final responses with the attempt', () => {
    expect(migration).toContain('for share of tests, classrooms')
    expect(migration).toContain('from public.classroom_enrollments')
    expect(migration).toContain('from public.test_questions')
    expect(migration).toContain('from public.test_attempts')
    expect(migration).toContain('from public.test_responses')
    expect(migration).toContain('insert into public.test_responses')
    expect(migration).toContain('update public.test_attempts')
    expect(migration).toContain('is_submitted = true')
  })

  it('saves partial attempts through a service-role-only atomic RPC', () => {
    expect(migration).toContain('create or replace function public.save_test_attempt_atomic(')
    expect(migration).toMatch(
      /revoke all on function public\.save_test_attempt_atomic[\s\S]+from public, anon, authenticated;/,
    )
    expect(migration).toMatch(
      /grant execute on function public\.save_test_attempt_atomic[\s\S]+to service_role;/,
    )
    expect(attemptRoute).toContain('saveTestAttemptSchema.safeParse')
    expect(attemptRoute).toContain('saveStudentTestAttempt')
    expect(attemptRoute).not.toContain(".from('test_attempts')")
  })

  it('serializes availability changes through the parent test row', () => {
    expect(migration).toContain('create trigger lock_test_student_availability_parent')
    expect(migration).toContain('before insert or update or delete on public.test_student_availability')
    expect(migration).toMatch(/from public\.tests[\s\S]+for update;/)
    expect(migration).toContain('id = any(array[old.test_id, new.test_id])')
    expect(migration).toContain('order by id')
  })

  it('serializes question mutations and attempt deletion through the parent test row', () => {
    expect(migration).toContain('create trigger lock_test_question_parent')
    expect(migration).toContain('before insert or update or delete on public.test_questions')
    expect(migration).toContain('create or replace function public.delete_student_test_attempt_atomic(')
    expect(migration).toContain('create or replace function public.delete_student_test_attempts_atomic(')
    expect(migration.match(/from public\.tests\n  where id = p_test_id\n  for update;/g)).toHaveLength(2)
  })

  it('keeps direct response and attempt writes out of the route', () => {
    expect(route).toContain("submitTestResponsesSchema.safeParse")
    expect(route).toContain('submitStudentTestAttempt')
    expect(route).not.toContain(".from('test_responses')")
    expect(route).not.toContain(".from('test_attempts')")
  })
})
