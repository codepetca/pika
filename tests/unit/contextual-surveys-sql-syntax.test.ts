import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Source regression only: these checks do NOT execute PostgreSQL or prove
// native parsing. Root must verify the reviewed migration in a fresh attempt.
const sql = readFileSync('supabase/migrations/269_contextual_surveys_workflow.sql', 'utf8')
const responseFunction = sql.split('create function public.respond_to_survey_for_member_v1(')[1]?.split('$function$;')[0]
const textGuard = /if jsonb_typeof\(v_answer->'response_text'\) is distinct from 'string'\s+or \(select count\(\*\) from jsonb_object_keys\(v_answer\)\)<>\(case when v_question\.question_type='link' then 3 else 2 end\) then\s+raise exception using errcode='PT400', message='survey_invalid_text';\s+end if;/

describe('Survey response IF expression source grouping', () => {
  it('maps only transient aborts to busy and preserves lifecycle 55000 through every catch', () => {
    const allHandlers = [...sql.matchAll(/exception when ([\s\S]*?)\nend;/g)].map(match => match[1])
    const handlers = allHandlers.filter(handler => handler.includes("message='survey_operation_busy'"))
    expect(handlers).toHaveLength(4)
    for (const handler of handlers) {
      expect(handler).toContain("errcode='PT409', message='survey_operation_busy'")
      expect(handler).not.toMatch(/55000|object_not_in_prerequisite_state|others/i)
    }
    expect(handlers.filter(handler => handler.startsWith("sqlstate '40001' or sqlstate '40P01' or sqlstate '55P03' then"))).toHaveLength(2)
    for (const handler of handlers.filter(handler => handler.startsWith("sqlstate '40001'"))) {
      expect(handler).toContain('get stacked diagnostics v_conflict_message=message_text;')
      expect(handler).toMatch(/if sqlstate='40001' and v_conflict_message not in \('classroom_operation_busy','student_operation_busy'\) then\s+raise;\s+end if;/)
      expect(handler).not.toContain('course_blueprint_purge_waiting_for_classroom_purge')
      expect(handler.indexOf('raise;')).toBeLessThan(handler.indexOf("errcode='PT409'"))
    }
    expect(handlers.filter(handler => handler.startsWith('lock_not_available or deadlock_detected then'))).toHaveLength(2)
    expect([...sql.matchAll(/message='survey_operation_busy'/g)]).toHaveLength(4)
    expect(sql).toContain('perform public.guard_classroom_purge_lifecycle(v_classroom_id)')
  })
  it('groups the CASE expression within the actual text response IF, preserving link3 versus text2 keys', () => {
    expect(responseFunction).toBeDefined()
    expect(textGuard.test(responseFunction!)).toBe(true)
  })
  it('denies the prior naked CASE regression without claiming native parser acceptance', () => {
    const ungrouped = responseFunction?.replace("(case when v_question.question_type='link' then 3 else 2 end)",
      "case when v_question.question_type='link' then 3 else 2 end")
    expect(textGuard.test(ungrouped!)).toBe(false)
  })
})
