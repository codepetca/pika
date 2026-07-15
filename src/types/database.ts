import type {
  AssignmentSubmissionRequirementDraft,
  AssignmentSubmissionValidationPolicyJson,
} from '@/lib/assignment-submission-requirements'
import type { Database as GeneratedDatabase, Json } from '@/types/database.generated'
import type {
  ActualCourseSiteConfig,
  AssessmentDraftContent,
  AssessmentDraftType,
  AssignmentAiGradingRunErrorSample,
  AssignmentAiGradingRunStatus,
  AuthenticityFlag,
  PlannedCourseSiteConfig,
  RepoReviewEvidenceItem,
  RepoReviewSemanticBreakdown,
  RepoReviewTimelinePoint,
  RepoReviewWarning,
  SurveyStatus,
  TestAiGradingRunErrorSample,
  TestAiGradingRunStatus,
  TestDocument,
  TestDraftContent,
  TestFocusEventType,
  TestQuestionType,
  TiptapContent,
  UserRole,
} from '@/types'

type Replace<Base, Changes> = Omit<Base, keyof Changes> & Changes
type PublicSchema = GeneratedDatabase['public']
type GeneratedTables = PublicSchema['Tables']
type GeneratedFunctions = PublicSchema['Functions']

type TableContract<
  Name extends keyof GeneratedTables,
  RowChanges,
  InsertChanges = Partial<RowChanges>,
  UpdateChanges = Partial<InsertChanges>,
> = Replace<GeneratedTables[Name], {
  Row: Replace<GeneratedTables[Name]['Row'], RowChanges>
  Insert: Replace<GeneratedTables[Name]['Insert'], InsertChanges>
  Update: Replace<GeneratedTables[Name]['Update'], UpdateChanges>
}>

type FunctionContract<
  Name extends keyof GeneratedFunctions,
  ReturnValue,
  Args = GeneratedFunctions[Name]['Args'],
> = Replace<GeneratedFunctions[Name], { Args: Args; Returns: ReturnValue }>

type TestMutationCounts = {
  deleted_attempts: number
  deleted_responses: number
  deleted_focus_events: number
  deleted_ai_grading_items: number
}

type TestWorkDeletionCounts = TestMutationCounts & {
  requested_count: number
  deleted_student_count: number
}

type TestAccessMutationCounts = {
  locked_count: number
  unlocked_count: number
  inserted_responses: number
}

type UnsubmittedAttempt = {
  id: string
  student_id: string
  responses: Json
}

type RosterRemovalCounts = {
  requested_count: number
  deleted_roster_entries: number
  deleted_entries: number
  deleted_assignment_docs: number
  deleted_enrollments: number
}

type TableOverrides = {
  assessment_drafts: TableContract<
    'assessment_drafts',
    { assessment_type: AssessmentDraftType; content: AssessmentDraftContent | TestDraftContent },
    { assessment_type: AssessmentDraftType; content: AssessmentDraftContent | TestDraftContent },
    { assessment_type?: AssessmentDraftType; content?: AssessmentDraftContent | TestDraftContent }
  >
  assignment_ai_grading_runs: TableContract<
    'assignment_ai_grading_runs',
    {
      error_samples_json: AssignmentAiGradingRunErrorSample[]
      requested_student_ids_json: string[]
      status: AssignmentAiGradingRunStatus
    },
    {
      error_samples_json?: AssignmentAiGradingRunErrorSample[]
      requested_student_ids_json?: string[]
      status?: AssignmentAiGradingRunStatus
    }
  >
  assignment_doc_history: TableContract<
    'assignment_doc_history',
    { snapshot: TiptapContent | null },
    { snapshot?: TiptapContent | null }
  >
  assignment_docs: TableContract<
    'assignment_docs',
    { authenticity_flags: AuthenticityFlag[] | null; content: TiptapContent },
    { authenticity_flags?: AuthenticityFlag[] | null; content?: TiptapContent }
  >
  assignment_repo_review_results: TableContract<
    'assignment_repo_review_results',
    {
      evidence_json: RepoReviewEvidenceItem[]
      semantic_breakdown_json: RepoReviewSemanticBreakdown
      timeline_json: RepoReviewTimelinePoint[]
    },
    {
      evidence_json?: RepoReviewEvidenceItem[]
      semantic_breakdown_json?: RepoReviewSemanticBreakdown
      timeline_json?: RepoReviewTimelinePoint[]
    }
  >
  assignment_repo_review_runs: TableContract<
    'assignment_repo_review_runs',
    { warnings_json: RepoReviewWarning[] },
    { warnings_json?: RepoReviewWarning[] }
  >
  assignment_submission_requirements: TableContract<
    'assignment_submission_requirements',
    { validation_policy_json: AssignmentSubmissionValidationPolicyJson },
    { validation_policy_json?: AssignmentSubmissionValidationPolicyJson }
  >
  assignments: TableContract<
    'assignments',
    { rich_instructions: TiptapContent | null },
    { rich_instructions?: TiptapContent | null }
  >
  classrooms: TableContract<
    'classrooms',
    { actual_site_config: ActualCourseSiteConfig },
    { actual_site_config?: ActualCourseSiteConfig }
  >
  classroom_resources: TableContract<
    'classroom_resources',
    { content: TiptapContent },
    { content?: TiptapContent }
  >
  classwork_materials: TableContract<
    'classwork_materials',
    { content: TiptapContent },
    // The before-insert trigger assigns a position when compatibility code omits it.
    { content?: TiptapContent; position?: number }
  >
  course_blueprint_assessments: TableContract<
    'course_blueprint_assessments',
    {
      assessment_type: AssessmentDraftType
      content: AssessmentDraftContent | TestDraftContent
      documents: TestDocument[]
    },
    {
      assessment_type: AssessmentDraftType
      content?: AssessmentDraftContent | TestDraftContent
      documents?: TestDocument[]
    },
    {
      assessment_type?: AssessmentDraftType
      content?: AssessmentDraftContent | TestDraftContent
      documents?: TestDocument[]
    }
  >
  course_blueprint_assignments: TableContract<
    'course_blueprint_assignments',
    { submission_requirements_json: AssignmentSubmissionRequirementDraft[] },
    { submission_requirements_json?: AssignmentSubmissionRequirementDraft[] }
  >
  course_blueprints: TableContract<
    'course_blueprints',
    { planned_site_config: PlannedCourseSiteConfig },
    { planned_site_config?: PlannedCourseSiteConfig }
  >
  entries: TableContract<
    'entries',
    { rich_content: TiptapContent | null },
    { rich_content?: TiptapContent | null }
  >
  lesson_plans: TableContract<
    'lesson_plans',
    { content: TiptapContent },
    { content?: TiptapContent }
  >
  surveys: TableContract<
    'surveys',
    { status: SurveyStatus },
    { status?: SurveyStatus }
  >
  test_ai_grading_runs: TableContract<
    'test_ai_grading_runs',
    {
      error_samples_json: TestAiGradingRunErrorSample[]
      requested_student_ids_json: string[]
      status: TestAiGradingRunStatus
    },
    {
      error_samples_json?: TestAiGradingRunErrorSample[]
      requested_student_ids_json?: string[]
      status?: TestAiGradingRunStatus
    }
  >
  test_attempts: TableContract<
    'test_attempts',
    { authenticity_flags: AuthenticityFlag[] | null },
    { authenticity_flags?: AuthenticityFlag[] | null }
  >
  test_focus_events: TableContract<
    'test_focus_events',
    { event_type: TestFocusEventType },
    { event_type: TestFocusEventType },
    { event_type?: TestFocusEventType }
  >
  test_questions: TableContract<
    'test_questions',
    {
      ai_reference_cache_answers: string[] | null
      options: string[]
      question_type: TestQuestionType
    },
    {
      ai_reference_cache_answers?: string[] | null
      options?: string[]
      question_type?: TestQuestionType
    }
  >
  test_responses: TableContract<
    'test_responses',
    { ai_reference_answers: string[] | null },
    { ai_reference_answers?: string[] | null }
  >
  tests: TableContract<
    'tests',
    { documents: TestDocument[]; status: 'draft' | 'active' | 'closed' },
    { documents?: TestDocument[]; status?: 'draft' | 'active' | 'closed' }
  >
  users: TableContract<
    'users',
    { role: UserRole },
    { role: UserRole },
    { role?: UserRole }
  >
}

type FunctionOverrides = {
  claim_assignment_ai_grading_run: FunctionContract<
    'claim_assignment_ai_grading_run',
    TableOverrides['assignment_ai_grading_runs']['Row'][]
  >
  claim_test_ai_grading_run: FunctionContract<
    'claim_test_ai_grading_run',
    TableOverrides['test_ai_grading_runs']['Row'][]
  >
  renew_test_ai_grading_run_lease: FunctionContract<
    'renew_test_ai_grading_run_lease',
    boolean
  >
  close_test_for_grading_atomic: FunctionContract<
    'close_test_for_grading_atomic',
    { closed_count: number; finalized_attempts: number; inserted_responses: number }
  >
  create_assignment_ai_grading_run_atomic: FunctionContract<
    'create_assignment_ai_grading_run_atomic',
    TableOverrides['assignment_ai_grading_runs']['Row']
  >
  finalize_assignment_ai_grading_item_atomic: FunctionContract<
    'finalize_assignment_ai_grading_item_atomic',
    Json,
    Replace<GeneratedFunctions['finalize_assignment_ai_grading_item_atomic']['Args'], {
      p_ai_feedback_model: string | null
      p_ai_feedback_suggestion: string | null
      p_graded_by: string | null
      p_skip_reason: string | null
    }>
  >
  finalize_test_ai_grading_item_atomic: FunctionContract<
    'finalize_test_ai_grading_item_atomic',
    Json,
    Replace<GeneratedFunctions['finalize_test_ai_grading_item_atomic']['Args'], {
      p_ai_reference_answers: string[] | null
    }>
  >
  create_course_blueprint_atomic: FunctionContract<
    'create_course_blueprint_atomic',
    Json,
    Replace<GeneratedFunctions['create_course_blueprint_atomic']['Args'], {
      p_expected_source_revision: number | null
      p_source_classroom_id: string | null
    }>
  >
  delete_student_test_attempt_atomic: FunctionContract<
    'delete_student_test_attempt_atomic',
    TestMutationCounts
  >
  delete_student_test_attempts_atomic: FunctionContract<
    'delete_student_test_attempts_atomic',
    TestWorkDeletionCounts
  >
  finalize_test_attempts_for_grading_atomic: FunctionContract<
    'finalize_test_attempts_for_grading_atomic',
    { finalized_attempts: number; inserted_responses: number }
  >
  remove_classroom_roster_entries_atomic: FunctionContract<
    'remove_classroom_roster_entries_atomic',
    RosterRemovalCounts
  >
  return_assignment_feedback_atomic: FunctionContract<
    'return_assignment_feedback_atomic',
    Json,
    Replace<GeneratedFunctions['return_assignment_feedback_atomic']['Args'], {
      p_expected_doc_updated_at: string | null
      p_feedback: string | null
    }>
  >
  save_assignment_grades_atomic: FunctionContract<
    'save_assignment_grades_atomic',
    Json,
    Replace<GeneratedFunctions['save_assignment_grades_atomic']['Args'], {
      p_score_completion: number | null
      p_score_thinking: number | null
      p_score_workflow: number | null
    }>
  >
  save_assignment_ai_grade_atomic: FunctionContract<
    'save_assignment_ai_grade_atomic',
    Json,
    Replace<GeneratedFunctions['save_assignment_ai_grade_atomic']['Args'], {
      p_ai_feedback_model: string | null
      p_ai_feedback_suggestion: string | null
      p_expected_doc_updated_at: string | null
      p_graded_by: string | null
    }>
  >
  save_test_attempt_atomic: FunctionContract<
    'save_test_attempt_atomic',
    Json,
    Replace<GeneratedFunctions['save_test_attempt_atomic']['Args'], {
      p_responses: Json
    }>
  >
  save_test_response_grades_atomic: FunctionContract<
    'save_test_response_grades_atomic',
    Json,
    Replace<GeneratedFunctions['save_test_response_grades_atomic']['Args'], {
      p_grade_rows: Json
      p_student_id: string | null
    }>
  >
  set_test_ai_grading_item_state_atomic: FunctionContract<
    'set_test_ai_grading_item_state_atomic',
    boolean,
    Replace<GeneratedFunctions['set_test_ai_grading_item_state_atomic']['Args'], {
      p_completed_at: string | null
      p_last_error_code: string | null
      p_last_error_message: string | null
      p_next_retry_at: string | null
      p_question_grading_snapshot: Json | null
      p_started_at: string | null
    }>
  >
  submit_test_attempt_atomic: FunctionContract<
    'submit_test_attempt_atomic',
    { attempt_id: string; submitted_at: string; inserted_responses: number },
    Replace<GeneratedFunctions['submit_test_attempt_atomic']['Args'], {
      p_responses: Json
      p_submitted_at?: string
    }>
  >
  return_test_attempts_atomic: FunctionContract<
    'return_test_attempts_atomic',
    { returned_count: number; updated_count: number; inserted_count: number }
  >
  unsubmit_test_attempts_atomic: FunctionContract<
    'unsubmit_test_attempts_atomic',
    { unsubmitted_count: number; deleted_responses: number; attempts: UnsubmittedAttempt[] }
  >
  upsert_developer_feedback_candidate: FunctionContract<
    'upsert_developer_feedback_candidate',
    Json,
    Replace<GeneratedFunctions['upsert_developer_feedback_candidate']['Args'], {
      p_affected_area: string | null
      p_implementation_hint: string | null
    }>
  >
  update_test_student_access_atomic: FunctionContract<
    'update_test_student_access_atomic',
    TestAccessMutationCounts
  >
}

export type Database = Replace<GeneratedDatabase, {
  public: Replace<PublicSchema, {
    Tables: Omit<GeneratedTables, keyof TableOverrides> & TableOverrides
    Functions: Omit<GeneratedFunctions, keyof FunctionOverrides> & FunctionOverrides
  }>
}>

type Tables = Database['public']['Tables']

export type TableRow<Name extends keyof Tables> = Tables[Name]['Row']
export type TableInsert<Name extends keyof Tables> = Tables[Name]['Insert']
export type TableUpdate<Name extends keyof Tables> = Tables[Name]['Update']
