export type ClassroomArchiveResourceDefinition = {
  table: string
  primary_key: readonly string[]
  actor_columns: readonly string[]
}

function archiveResource<const Table extends string>(
  table: Table,
  actorColumns: readonly string[] = [],
  primaryKey: readonly string[] = ['id'],
): ClassroomArchiveResourceDefinition & { table: Table } {
  return {
    table,
    primary_key: primaryKey,
    actor_columns: actorColumns,
  }
}

// Archive v1 is an immutable historical contract. Do not derive it from the
// current database inventory: those resources will change as legacy tables retire.
export const CLASSROOM_ARCHIVE_V1_RESOURCES = [
  archiveResource('classrooms', ['teacher_id']),
  archiveResource('announcements', ['created_by']),
  archiveResource('announcement_reads', ['user_id']),
  archiveResource('assessment_drafts', ['created_by', 'updated_by']),
  archiveResource('assignments', ['created_by']),
  archiveResource('assignment_ai_grading_runs', ['triggered_by']),
  archiveResource('assignment_ai_grading_run_items', ['student_id']),
  archiveResource('assignment_docs', ['student_id']),
  archiveResource('assignment_doc_history'),
  archiveResource('assignment_feedback_entries', ['created_by', 'student_id']),
  archiveResource('assignment_repo_review_runs', ['triggered_by']),
  archiveResource('assignment_repo_review_results', ['student_id']),
  archiveResource('assignment_repo_targets', ['student_id']),
  archiveResource('assignment_submission_requirements'),
  archiveResource('assignment_submission_artifacts', ['student_id']),
  archiveResource('class_days'),
  archiveResource('classroom_enrollments', ['student_id']),
  archiveResource('classroom_resources', ['updated_by']),
  archiveResource('classroom_roster'),
  archiveResource('classwork_materials', ['created_by']),
  archiveResource('entries', ['student_id']),
  archiveResource('gradebook_settings', [], ['classroom_id']),
  archiveResource('lesson_plans'),
  archiveResource('log_summaries'),
  archiveResource('quizzes', ['created_by']),
  archiveResource('quiz_questions'),
  archiveResource('quiz_responses', ['student_id']),
  archiveResource('quiz_student_scores', ['student_id']),
  archiveResource('report_cards', ['created_by']),
  archiveResource('report_card_rows', ['student_id']),
  archiveResource('surveys', ['created_by']),
  archiveResource('survey_questions'),
  archiveResource('survey_responses', ['student_id']),
  archiveResource('tests', ['created_by']),
  archiveResource('test_ai_grading_runs', ['triggered_by']),
  archiveResource('test_ai_grading_run_items', ['student_id']),
  archiveResource('test_attempts', ['closed_for_grading_by', 'returned_by', 'student_id']),
  archiveResource('test_attempt_history'),
  archiveResource('test_focus_events', ['student_id']),
  archiveResource('test_questions'),
  archiveResource('test_responses', ['graded_by', 'student_id']),
  archiveResource('test_student_availability', ['student_id', 'updated_by']),
] as const satisfies readonly ClassroomArchiveResourceDefinition[]

export const LEGACY_QUIZ_ARCHIVE_V1_RESOURCES = [
  'quizzes',
  'quiz_questions',
  'quiz_responses',
  'quiz_student_scores',
] as const

export const CLASSROOM_ARCHIVE_V1_RESTORE_ORDER = [
  'classrooms',
  'announcements',
  'assessment_drafts',
  'assignments',
  'class_days',
  'classroom_enrollments',
  'classroom_resources',
  'classroom_roster',
  'classwork_materials',
  'entries',
  'gradebook_settings',
  'lesson_plans',
  'log_summaries',
  'quizzes',
  'report_cards',
  'surveys',
  'tests',
  'announcement_reads',
  'assignment_ai_grading_runs',
  'assignment_docs',
  'assignment_feedback_entries',
  'assignment_repo_review_runs',
  'assignment_repo_targets',
  'assignment_submission_requirements',
  'quiz_questions',
  'quiz_student_scores',
  'report_card_rows',
  'survey_questions',
  'test_ai_grading_runs',
  'test_attempts',
  'test_focus_events',
  'test_questions',
  'test_student_availability',
  'assignment_ai_grading_run_items',
  'assignment_doc_history',
  'assignment_repo_review_results',
  'assignment_submission_artifacts',
  'quiz_responses',
  'survey_responses',
  'test_attempt_history',
  'test_responses',
  'test_ai_grading_run_items',
] as const

const legacyQuizTables = new Set<string>(LEGACY_QUIZ_ARCHIVE_V1_RESOURCES)

// This graph is inactive until the separately authorized archive-v2 migration
// installs matching tables and database contracts.
export const CLASSROOM_ARCHIVE_V2_RESOURCES = [
  ...CLASSROOM_ARCHIVE_V1_RESOURCES.filter((resource) =>
    !legacyQuizTables.has(resource.table),
  ),
  archiveResource('classroom_retired_assessment_records'),
  archiveResource('classroom_retired_assessment_record_actors', ['actor_id']),
] as const satisfies readonly ClassroomArchiveResourceDefinition[]

export const CLASSROOM_ARCHIVE_V2_RESTORE_ORDER = [
  ...CLASSROOM_ARCHIVE_V1_RESOURCES
    .map((resource) => resource.table)
    .filter((table) => !legacyQuizTables.has(table)),
  'classroom_retired_assessment_records',
  'classroom_retired_assessment_record_actors',
] as const
