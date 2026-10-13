import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadAssignmentListReviewedMigrations } from '../../scripts/contextual-assignment-list-proof-platform'
import { validateSurveyNativeMigrationProfile } from '../../scripts/contextual-surveys-native-contracts'

// Source regression only: these checks do NOT execute PostgreSQL or prove
// native parsing. Root must verify the reviewed migration in a fresh attempt.
const sql = readFileSync('supabase/migrations/263_contextual_surveys_workflow.sql', 'utf8')
const responseFunction = sql.split('create function public.respond_to_survey_for_member_v1(')[1]?.split('$function$;')[0]
const textGuard = /if jsonb_typeof\(v_answer->'response_text'\) is distinct from 'string'\s+or \(select count\(\*\) from jsonb_object_keys\(v_answer\)\)<>\(case when v_question\.question_type='link' then 3 else 2 end\) then\s+raise exception using errcode='PT400', message='survey_invalid_text';\s+end if;/

describe('Survey263 response IF expression source grouping', () => {
  it('groups the CASE expression within the actual text response IF, preserving link3 versus text2 keys', () => {
    expect(responseFunction).toBeDefined()
    expect(textGuard.test(responseFunction!)).toBe(true)
  })
  it('denies the prior naked CASE regression without claiming native parser acceptance', () => {
    const ungrouped = responseFunction?.replace("(case when v_question.question_type='link' then 3 else 2 end)",
      "case when v_question.question_type='link' then 3 else 2 end")
    expect(textGuard.test(ungrouped!)).toBe(false)
  })
  it('keeps the actual sealed profile closed to the self-consistent prior migration bytes and digest', () => {
    const migrations = loadAssignmentListReviewedMigrations(process.cwd()).map(row => ({ ...row }))
    migrations[262].sql = sql.replace("(case when v_question.question_type='link' then 3 else 2 end)",
      "case when v_question.question_type='link' then 3 else 2 end")
    migrations[262].sha256 = '26f99a6a2b269f29f56b07455c5460f796d7b470876624aedc43de90906f6c25'
    expect(() => validateSurveyNativeMigrationProfile(migrations)).toThrow()
  })
})
