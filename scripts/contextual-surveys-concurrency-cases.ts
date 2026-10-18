/** Inert SQL cases for the existing independent-connection native driver.
 * Root owns connection/target guards, transaction capture, rollback and receipts. */
import { z } from 'zod'
import type { Json } from '../src/types/database.generated'
const identity = z.object({ ownerId: z.string().uuid(), memberId: z.string().uuid(), resultReaderId: z.string().uuid(), resultSurveyId: z.string().uuid(), classroomId: z.string().uuid(), surveyId: z.string().uuid(), questionId: z.string().uuid(), foreignSurveyId: z.string().uuid() }).strict()
export function contextualSurveysConcurrencyCases(raw: z.infer<typeof identity>, source: { expectedQuestions: Json; responses: Json }) {
  const f = identity.parse(raw)
  const ownerRead = `select public.get_survey_for_owner_v1('${f.ownerId}','${f.surveyId}');`
  const memberRead = `select public.get_survey_for_member_v1('${f.memberId}','${f.surveyId}');`
  const questionWrite = `update public.survey_questions set question_text='Concurrent question' where id='${f.questionId}' and survey_id='${f.surveyId}';`
  const questions = JSON.stringify(z.array(z.json()).parse(source.expectedQuestions)).replaceAll("'", "''")
  const responses = JSON.stringify(z.record(z.string(), z.json()).parse(source.responses)).replaceAll("'", "''")
  const respond = `select public.respond_to_survey_for_member_v1('${f.memberId}','${f.surveyId}','${f.classroomId}','${questions}'::jsonb,'${responses}'::jsonb);`
  return Object.freeze([
    { name: 'legacy_question_after_snapshot', first: ownerRead, second: questionWrite, expected: 'second blocks on first; first snapshot is unchanged; second commits afterward' },
    { name: 'snapshot_after_legacy_question', first: questionWrite, second: ownerRead, expected: 'second returns PT409 promptly from revision NOWAIT; retry observes committed question' },
    { name: 'owner_replacement_after_snapshot', first: ownerRead, second: `update public.classrooms set teacher_id='${f.memberId}' where id='${f.classroomId}';`, expected: 'second blocks until first ends; old owner read subsequently returns PT403' },
    { name: 'archive_after_member_snapshot', first: memberRead, second: `update public.classrooms set archived_at=clock_timestamp() where id='${f.classroomId}';`, expected: 'second blocks until first ends; member read subsequently returns PT403' },
    { name: 'member_removal_after_snapshot', first: memberRead, second: `delete from public.classroom_enrollments where classroom_id='${f.classroomId}' and student_id='${f.memberId}';`, expected: 'second fails retryably through existing membership fence or blocks; after successful removal no member read succeeds' },
    { name: 'subject_purge_before_other_member_results', first: `select pg_advisory_xact_lock(hashtextextended('pika-student-purge-subject:${f.memberId}',0));`, second: `select public.get_survey_results_for_member_v1('${f.resultReaderId}','${f.resultSurveyId}');`, expected: 'separate aggregate Survey has committed member response and distinct enrolled result reader; second returns PT409 with no disclosure; after lock release retry returns the response without student identity; reverse subject lock waits until aggregate transaction ends' },
    { name: 'classroom_purge_before_owner_snapshot', first: `select pg_advisory_xact_lock(hashtextextended('pika-classroom-operation:${f.classroomId}',0));`, second: ownerRead, expected: 'second returns PT409, no data' },
    { name: 'question_reparent_after_snapshot', first: ownerRead, second: `update public.survey_questions set survey_id='${f.foreignSurveyId}' where id='${f.questionId}';`, expected: 'second blocks on revision fence; current Survey no longer discloses question after second commits' },
    { name: 'response_after_question_text_change', first: questionWrite, second: respond, expected: 'second initially PT409; after first commits stale expected questions still PT409; no answers persisted' },
    { name: 'response_after_question_type_change', first: `update public.survey_questions set question_type='multiple_choice',options='["A","B"]'::jsonb where id='${f.questionId}';`, second: respond, expected: 'second initially PT409; after first commits stale expected questions still PT409; no type-mismatched answers persisted' },
    { name: 'response_after_choice_change', first: `update public.survey_questions set question_type='multiple_choice',options='["Changed A","Changed B"]'::jsonb where id='${f.questionId}';`, second: respond, expected: 'second initially PT409; after first commits stale expected questions still PT409; no answers interpreted against changed options' },
    { name: 'response_after_text_limit_change', first: `update public.survey_questions set response_max_chars=1 where id='${f.questionId}';`, second: respond, expected: 'second initially PT409; after first commits stale expected questions still PT409; no overlong answer persisted' },
    { name: 'response_after_close', first: `update public.surveys set status='closed' where id='${f.surveyId}';`, second: respond, expected: 'second initially PT409; after first commits response PT400; zero new rows' },
    { name: 'static_duplicate_response', first: respond, second: respond, expected: 'first 201 evidence; second initially PT409; after first commits second PT400; one complete vector' },
    { name: 'dynamic_duplicate_response', first: respond, second: respond, expected: 'fixture dynamic flag true; second initially PT409; retry after first commit succeeds updated=true; one complete vector and unchanged submitted timestamps' },
  ])
}
