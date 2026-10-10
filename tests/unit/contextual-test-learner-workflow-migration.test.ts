import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const source = () => readFileSync('supabase/migrations/257_contextual_test_learner_workflow.sql', 'utf8')
describe('contextual learner Test concrete locked boundary', () => {
  it('seeds rollback Tests with positive maxima compatible with the retained schema constraint', () => {
    const schema = readFileSync('supabase/migrations/039_quiz_tests_and_focus_events.sql', 'utf8')
    expect(schema).toMatch(/points_possible numeric\(6,2\) not null default 100 check \(points_possible > 0\)/)
    const fixture = readFileSync('scripts/check-contextual-test-learner-workflow.sql', 'utf8')
    const values = fixture.match(/insert into public\.tests\(id,classroom_id,title,status,points_possible,created_by\) values\s*([\s\S]*?);/)
    expect(values).not.toBeNull()
    const rows = [...values![1].matchAll(/\('[^']+','[^']+','([^']+)','[^']+',(-?\d+(?:\.\d+)?),'[^']+'\)/g)]
    expect(rows.map(row => row[1])).toEqual(['Participation', 'Closed recovery'])
    for (const row of rows) expect(Number(row[2])).toBeGreaterThan(0)
  })
  it('checks current membership and visibility before invoking the244 conflict-producing RPCs', () => {
    const sql = source(); const authority = sql.indexOf('test_learner_member_forbidden')
    expect(authority).toBeGreaterThan(0)
    for (const inner of ['public.start_test_attempt_revision_atomic','public.save_test_attempt_revision_atomic','public.submit_test_attempt_revision_atomic']) {
      expect(sql.indexOf(inner)).toBeGreaterThan(authority)
    }
    expect(sql).toContain('v_classroom.teacher_id = p_actor_id')
    expect(sql).toContain("v_classroom.feature_visibility->'tests' = 'false'::jsonb")
    expect(sql).toContain('for share nowait')
    const lifecycleFence = sql.indexOf("p_operation in ('start','save','submit') and not v_can_continue")
    expect(lifecycleFence).toBeGreaterThan(0)
    expect(lifecycleFence).toBeLessThan(sql.indexOf('public.save_test_attempt_revision_atomic'))
    expect(sql).not.toMatch(/student\.role\s*=\s*'student'/)
  })
  it('requires exact-old-tuple collapse refusal and unchanged history/answers/revision in the rollback contract', () => {
    const fixture = readFileSync('scripts/check-contextual-test-learner-workflow.sql', 'utf8')
    const expiry = fixture.slice(fixture.indexOf('-- Expiry is distinct'), fixture.indexOf("'focus','"))
    expect(expiry).toContain("clock_timestamp()-interval '11 seconds'")
    expect(expiry).toContain("'expected_last',plan#>'{result,last_history}','collapse',true")
    expect(expiry).toContain("exception when sqlstate 'PT409'")
    expect(expiry).toContain('is distinct from old_history')
    expect(expiry).toContain('is distinct from answers')
    expect(expiry).toContain('is distinct from revision')
    expect(source()).toContain("v_history.created_at<=pg_catalog.clock_timestamp()-interval '10 seconds'")
  })
  it('keeps legacy functions intact, pins privilege, limits and protected history revision', () => {
    const sql = source(); expect(sql).not.toMatch(/create or replace function/)
    expect(sql).toContain("set search_path = ''"); expect(sql).toContain("set statement_timeout = '8s'")
    expect(sql).toContain('limit 10001'); expect(sql).toContain('8388608'); expect(sql).toContain('2097152')
    expect(sql).toContain('v_attempt.draft_revision is distinct from')
    expect(sql).toContain('from public, anon, authenticated')
    expect(sql).toContain('to service_role')
  })
  it('aggregates only current enrolled returned nonowner peers and never projects their raw rows', () => {
    const sql = source()
    expect(sql.match(/member\.student_id<>v_classroom\.teacher_id/g)).toHaveLength(2)
    expect(sql).toContain('member.classroom_id=v_classroom_id and member.student_id=response.student_id')
    expect(sql).toContain('attempt.student_id=response.student_id and attempt.returned_at is not null')
    expect(sql).toContain('group by response.question_id,response.selected_option')
    expect(sql).not.toContain("'peer_responses'")
  })
})
