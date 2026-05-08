import type { Operation } from 'fast-json-patch'

export type UserRole = 'student' | 'teacher'

export type AttendanceStatus = 'present' | 'absent' | 'pending'

export type MoodEmoji = '😊' | '🙂' | '😐' | '😟' | '😢'

export interface User {
  id: string
  email: string
  role: UserRole
  email_verified_at: string | null
  password_hash: string | null
  created_at: string
}

export type VerificationPurpose = 'signup' | 'reset_password'

export interface VerificationCode {
  id: string
  user_id: string
  code_hash: string
  purpose: VerificationPurpose
  expires_at: string
  attempts: number
  used_at: string | null
  created_at: string
}

export interface Session {
  id: string
  user_id: string
  token: string
  expires_at: string
  created_at: string
}

export type LessonPlanVisibility = 'current_week' | 'one_week_ahead' | 'all'

export type PublishedCourseSiteLessonPlanScope = 'current_week' | 'one_week_ahead' | 'all'

export interface PlannedCourseSiteConfig {
  overview: boolean
  outline: boolean
  resources: boolean
  assignments: boolean
  quizzes: boolean
  tests: boolean
  lesson_plans: boolean
}

export interface ActualCourseSiteConfig extends PlannedCourseSiteConfig {
  announcements: boolean
  lesson_plan_scope: PublishedCourseSiteLessonPlanScope
}

export interface ClassroomBlueprintOrigin {
  blueprint_id: string
  blueprint_title: string
  package_manifest_version: string
  package_exported_at: string
}

export interface Classroom {
  id: string
  teacher_id: string
  title: string
  class_code: string
  position?: number
  term_label: string | null
  allow_enrollment: boolean
  start_date: string | null // YYYY-MM-DD, inclusive
  end_date: string | null // YYYY-MM-DD, inclusive
  lesson_plan_visibility: LessonPlanVisibility
  source_blueprint_id: string | null
  source_blueprint_origin: ClassroomBlueprintOrigin | null
  actual_site_slug: string | null
  actual_site_published: boolean
  actual_site_config: ActualCourseSiteConfig
  course_overview_markdown: string
  course_outline_markdown: string
  codepetpal_enabled: boolean
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface LessonPlan {
  id: string
  classroom_id: string
  date: string // YYYY-MM-DD
  content: TiptapContent
  content_markdown: string | null
  created_at: string
  updated_at: string
}

export interface StudentProfile {
  id: string
  user_id: string
  student_number: string | null
  first_name: string
  last_name: string
  created_at: string
}

export interface ClassroomEnrollment {
  id: string
  classroom_id: string
  student_id: string
  created_at: string
}

export interface ClassDay {
  id: string
  classroom_id: string
  date: string  // YYYY-MM-DD
  prompt_text: string | null
  is_class_day: boolean
}

export interface Entry {
  id: string
  student_id: string
  classroom_id: string
  date: string  // YYYY-MM-DD
  text: string
  rich_content: TiptapContent | null
  version: number
  minutes_reported: number | null
  mood: MoodEmoji | null
  created_at: string
  updated_at: string
  on_time: boolean
}

export interface SessionData {
  user: {
    id: string
    email: string
    role: UserRole
  }
}

export interface AttendanceRecord {
  student_email: string
  student_id: string
  student_first_name: string
  student_last_name: string
  dates: Record<string, AttendanceStatus>  // date -> status
  summary: {
    present: number
    absent: number
  }
}

export type Semester = 'semester1' | 'semester2'

export interface SemesterRange {
  start: string  // MM-DD
  end: string    // MM-DD
}

// Tiptap rich text editor types
export interface TiptapContent {
  type: 'doc'
  content?: TiptapNode[]
}

export interface TiptapNode {
  type: string
  attrs?: Record<string, any>
  content?: TiptapNode[]
  marks?: TiptapMark[]
  text?: string
}

export interface TiptapMark {
  type: string
  attrs?: Record<string, any>
}

export interface Assignment {
  id: string
  classroom_id: string
  title: string
  description: string
  instructions_markdown: string | null  // Canonical teacher-authored markdown instructions
  rich_instructions: TiptapContent | null  // Rich text instructions
  due_at: string  // ISO 8601 timestamp
  position: number
  is_draft: boolean  // Whether assignment is a draft (not visible to students)
  released_at: string | null  // When the assignment was released to students
  track_authenticity: boolean
  points_possible?: number
  include_in_final?: boolean
  created_by: string
  created_at: string
  updated_at: string
}

export interface AuthenticityFlag {
  timestamp: string
  wordDelta: number
  seconds: number
  wps: number
  reason: 'paste' | 'high_wps'
}

export interface AssignmentDoc {
  id: string
  assignment_id: string
  student_id: string
  content: TiptapContent  // Rich text content (JSONB)
  repo_url: string | null
  github_username: string | null
  is_submitted: boolean
  submitted_at: string | null
  viewed_at: string | null
  score_completion: number | null
  score_thinking: number | null
  score_workflow: number | null
  feedback: string | null
  teacher_feedback_draft: string | null
  teacher_feedback_draft_updated_at: string | null
  feedback_returned_at: string | null
  ai_feedback_suggestion: string | null
  ai_feedback_suggested_at: string | null
  ai_feedback_model: string | null
  teacher_cleared_at: string | null
  graded_at: string | null
  graded_by: string | null
  returned_at: string | null
  authenticity_score: number | null
  authenticity_flags: AuthenticityFlag[] | null
  created_at: string
  updated_at: string
}

export type AssignmentDocHistoryTrigger = 'autosave' | 'blur' | 'submit' | 'baseline' | 'restore'

export type JsonPatchOperation = Operation

export interface AssignmentDocHistoryEntry {
  id: string
  assignment_doc_id: string
  patch: JsonPatchOperation[] | null
  snapshot: TiptapContent | null
  word_count: number
  char_count: number
  paste_word_count: number | null
  keystroke_count: number | null
  trigger: AssignmentDocHistoryTrigger
  created_at: string
}

// Assignment status for display
export type AssignmentStatus =
  | 'not_started'
  | 'in_progress'
  | 'in_progress_late'
  | 'submitted_on_time'
  | 'submitted_late'
  | 'graded'
  | 'returned'
  | 'resubmitted'

// Extended types for UI display
export interface AssignmentWithStatus extends Assignment {
  status: AssignmentStatus
  doc?: AssignmentDoc
}

export interface AssignmentDocWithStudent extends AssignmentDoc {
  student_email: string
  student_name: string | null  // From student_profiles, null if not set
  status: AssignmentStatus
}

export interface AssignmentStats {
  total_students: number
  submitted: number
  late: number
}

export type AssignmentFeedbackEntryKind = 'teacher_feedback' | 'grading_feedback'

export interface AssignmentFeedbackEntry {
  id: string
  assignment_id: string
  student_id: string
  entry_kind: AssignmentFeedbackEntryKind
  author_type: 'teacher' | 'ai'
  body: string
  returned_at: string
  created_at: string
  created_by: string | null
}

export type AssignmentAiGradingRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'

export type AssignmentAiGradingItemStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'skipped'
  | 'failed'

export type AssignmentAiGradingSkipReason = 'missing_doc' | 'empty_doc'

export interface AssignmentAiGradingRunErrorSample {
  student_id: string | null
  code: string | null
  message: string
}

export interface AssignmentAiGradingRun {
  id: string
  assignment_id: string
  status: AssignmentAiGradingRunStatus
  triggered_by: string
  model: string | null
  requested_student_ids_json: string[]
  selection_hash: string
  requested_count: number
  gradable_count: number
  processed_count: number
  completed_count: number
  skipped_missing_count: number
  skipped_empty_count: number
  failed_count: number
  error_samples_json: AssignmentAiGradingRunErrorSample[]
  lease_token: string | null
  lease_expires_at: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface AssignmentAiGradingRunItem {
  id: string
  run_id: string
  assignment_id: string
  student_id: string
  assignment_doc_id: string | null
  queue_position: number
  status: AssignmentAiGradingItemStatus
  skip_reason: AssignmentAiGradingSkipReason | null
  attempt_count: number
  next_retry_at: string | null
  last_error_code: string | null
  last_error_message: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface AssignmentAiGradingRunSummary {
  id: string
  assignment_id: string
  status: AssignmentAiGradingRunStatus
  model: string | null
  requested_count: number
  gradable_count: number
  processed_count: number
  completed_count: number
  skipped_missing_count: number
  skipped_empty_count: number
  failed_count: number
  pending_count: number
  next_retry_at: string | null
  error_samples: AssignmentAiGradingRunErrorSample[]
  started_at: string | null
  completed_at: string | null
  created_at: string
}

export type TestAiGradingRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'

export type TestAiGradingItemStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'

export interface TestAiGradingRunErrorSample {
  student_id: string | null
  code: string | null
  message: string
}

export interface TestAiGradingRun {
  id: string
  test_id: string
  status: TestAiGradingRunStatus
  triggered_by: string
  model: string | null
  prompt_guideline_override: string | null
  requested_student_ids_json: string[]
  selection_hash: string
  requested_count: number
  eligible_student_count: number
  queued_response_count: number
  processed_count: number
  completed_count: number
  skipped_unanswered_count: number
  skipped_already_graded_count: number
  failed_count: number
  error_samples_json: TestAiGradingRunErrorSample[]
  lease_token: string | null
  lease_expires_at: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface TestAiGradingRunItem {
  id: string
  run_id: string
  test_id: string
  student_id: string
  question_id: string
  response_id: string
  queue_position: number
  status: TestAiGradingItemStatus
  attempt_count: number
  next_retry_at: string | null
  last_error_code: string | null
  last_error_message: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface TestAiGradingRunSummary {
  id: string
  test_id: string
  status: TestAiGradingRunStatus
  model: string | null
  prompt_guideline_override: string | null
  requested_count: number
  eligible_student_count: number
  queued_response_count: number
  processed_count: number
  completed_count: number
  skipped_unanswered_count: number
  skipped_already_graded_count: number
  failed_count: number
  pending_count: number
  next_retry_at: string | null
  error_samples: TestAiGradingRunErrorSample[]
  started_at: string | null
  completed_at: string | null
  created_at: string
}

export type RepoReviewProvider = 'github'
export type RepoReviewRunStatus = 'queued' | 'running' | 'completed' | 'failed'
export type AssignmentRepoTargetSelectionMode = 'auto' | 'teacher_override'
export type AssignmentRepoTargetValidationStatus =
  | 'missing'
  | 'ambiguous'
  | 'valid'
  | 'invalid'
  | 'private'
  | 'inaccessible'
export type RepoReviewSemanticCategory =
  | 'feature'
  | 'bugfix'
  | 'test'
  | 'refactor'
  | 'docs'
  | 'styling'
  | 'config'
  | 'generated'

export interface AssignmentRepoReviewConfig {
  assignment_id: string
  provider: RepoReviewProvider
  repo_owner: string
  repo_name: string
  default_branch: string
  review_start_at: string | null
  review_end_at: string | null
  include_pr_reviews: boolean
  config_json: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface UserGitHubIdentity {
  id: string
  user_id: string
  github_login: string | null
  commit_emails: string[]
  created_at: string
  updated_at: string
}

export interface AssignmentRepoTarget {
  id: string
  assignment_id: string
  student_id: string
  selected_repo_url: string | null
  override_github_username: string | null
  repo_owner: string | null
  repo_name: string | null
  selection_mode: AssignmentRepoTargetSelectionMode
  validation_status: AssignmentRepoTargetValidationStatus
  validation_message: string | null
  validated_at: string | null
  created_at: string
  updated_at: string
}

export interface RepoReviewWarning {
  code: string
  message: string
  student_id?: string
  github_login?: string
}

export interface AssignmentRepoReviewRun {
  id: string
  assignment_id: string
  repo_owner: string | null
  repo_name: string | null
  status: RepoReviewRunStatus
  triggered_by: string
  started_at: string
  completed_at: string | null
  source_ref: string | null
  metrics_version: string
  prompt_version: string
  model: string | null
  warnings_json: RepoReviewWarning[]
  created_at: string
}

export interface RepoReviewTimelinePoint {
  date: string
  weighted_contribution: number
  commit_count: number
}

export interface RepoReviewEvidenceItem {
  type: 'commit' | 'pull_request' | 'review' | 'issue'
  id: string
  title: string
  url?: string
  authored_at?: string
  summary?: string
  category?: RepoReviewSemanticCategory
}

export interface RepoReviewSemanticBreakdown {
  feature: number
  bugfix: number
  test: number
  refactor: number
  docs: number
  styling: number
  config: number
  generated: number
}

export interface AssignmentRepoReviewResult {
  id: string
  run_id: string
  assignment_id: string
  student_id: string
  github_login: string | null
  commit_count: number
  active_days: number
  session_count: number
  burst_ratio: number
  weighted_contribution: number
  relative_contribution_share: number
  spread_score: number
  iteration_score: number
  semantic_breakdown_json: Partial<RepoReviewSemanticBreakdown>
  timeline_json: RepoReviewTimelinePoint[]
  evidence_json: RepoReviewEvidenceItem[]
  draft_score_completion: number | null
  draft_score_thinking: number | null
  draft_score_workflow: number | null
  draft_feedback: string | null
  confidence: number
  created_at: string
}

export interface ClassroomResources {
  id: string
  classroom_id: string
  content: TiptapContent
  updated_at: string
  updated_by: string | null
}

export interface CourseBlueprint {
  id: string
  teacher_id: string
  title: string
  subject: string
  grade_level: string
  course_code: string
  term_template: string
  overview_markdown: string
  outline_markdown: string
  resources_markdown: string
  planned_site_slug: string | null
  planned_site_published: boolean
  planned_site_config: PlannedCourseSiteConfig
  position: number
  created_at: string
  updated_at: string
}

export interface CourseBlueprintAssignment {
  id: string
  course_blueprint_id: string
  title: string
  instructions_markdown: string
  default_due_days: number
  default_due_time: string
  points_possible: number | null
  include_in_final: boolean
  is_draft: boolean
  position: number
  created_at: string
  updated_at: string
}

export interface CourseBlueprintAssessment {
  id: string
  course_blueprint_id: string
  assessment_type: QuizAssessmentType
  title: string
  content: Record<string, unknown>
  documents: TestDocument[]
  position: number
  created_at: string
  updated_at: string
}

export interface CourseBlueprintLessonTemplate {
  id: string
  course_blueprint_id: string
  title: string
  content_markdown: string
  position: number
  created_at: string
  updated_at: string
}

export interface CourseBlueprintDetail extends CourseBlueprint {
  assignments: CourseBlueprintAssignment[]
  assessments: CourseBlueprintAssessment[]
  lesson_templates: CourseBlueprintLessonTemplate[]
  linked_classrooms: LinkedBlueprintClassroom[]
}

export interface CoursePackageManifest {
  version: string
  exported_at: string
  title: string
  subject: string
  grade_level: string
  course_code: string
  term_template: string
  planned_site_slug?: string | null
  planned_site_published?: boolean
  planned_site_config?: PlannedCourseSiteConfig
}

export interface CreateClassroomFromBlueprintInput {
  blueprintId: string
  title: string
  classCode?: string
  termLabel?: string
  semester?: 'semester1' | 'semester2'
  year?: number
  start_date?: string
  end_date?: string
}

// Quiz types
export type QuizStatus = 'draft' | 'active' | 'closed'
export type QuizAssessmentType = 'quiz' | 'test'
export type TestStudentAvailabilityState = 'open' | 'closed'
export type QuizFocusEventType =
  | 'away_start'
  | 'away_end'
  | 'route_exit_attempt'
  | 'window_unmaximize_attempt'
export type TestQuestionType = 'multiple_choice' | 'open_response'
export type TestDocumentSource = 'link' | 'upload' | 'text'

export interface TestDocument {
  id: string
  title: string
  source: TestDocumentSource
  url?: string
  content?: string
  snapshot_path?: string
  snapshot_content_type?: string
  synced_at?: string | null
}
export type TestAiGradingBasis = 'teacher_key' | 'generated_reference'

export interface QuizFocusSummary {
  exit_count: number
  away_count: number
  away_total_seconds: number
  route_exit_attempts: number
  window_unmaximize_attempts: number
  last_away_started_at: string | null
  last_away_ended_at: string | null
}

export interface Quiz {
  id: string
  classroom_id: string
  title: string
  assessment_type: QuizAssessmentType
  status: QuizStatus
  opens_at: string | null
  show_results: boolean
  documents?: TestDocument[]
  position: number
  points_possible?: number
  include_in_final?: boolean
  created_by: string
  created_at: string
  updated_at: string
}

export interface QuizQuestion {
  id: string
  quiz_id: string
  question_text: string
  options: string[]
  position: number
  question_type?: TestQuestionType
  points?: number
  response_max_chars?: number
  response_monospace?: boolean
  answer_key?: string | null
  sample_solution?: string | null
  correct_option?: number | null
  created_at: string
  updated_at: string
}

export interface QuizResponse {
  id: string
  quiz_id: string
  question_id: string
  student_id: string
  selected_option: number
  submitted_at: string
}

export interface TestQuestion {
  id: string
  test_id: string
  question_type: TestQuestionType
  question_text: string
  options: string[]
  correct_option: number | null
  answer_key: string | null
  sample_solution: string | null
  points: number
  response_max_chars: number
  response_monospace: boolean
  position: number
  created_at: string
  updated_at: string
}

export type TestResponseDraftValue =
  | {
      question_type: 'multiple_choice'
      selected_option: number
    }
  | {
      question_type: 'open_response'
      response_text: string
    }

export interface TestResponse {
  id: string
  test_id: string
  question_id: string
  student_id: string
  selected_option: number | null
  response_text: string | null
  score: number | null
  feedback: string | null
  graded_at: string | null
  graded_by: string | null
  ai_grading_basis: TestAiGradingBasis | null
  ai_reference_answers: string[] | null
  ai_model: string | null
  submitted_at: string
}

export type TestAttemptHistoryTrigger = 'autosave' | 'blur' | 'submit' | 'baseline'

export interface TestAttempt {
  id: string
  test_id: string
  student_id: string
  responses: Record<string, TestResponseDraftValue>
  is_submitted: boolean
  submitted_at: string | null
  returned_at: string | null
  returned_by: string | null
  authenticity_score: number | null
  authenticity_flags: AuthenticityFlag[] | null
  created_at: string
  updated_at: string
}

export interface TestAttemptHistoryEntry {
  id: string
  test_attempt_id: string
  patch: JsonPatchOperation[] | null
  snapshot: Record<string, TestResponseDraftValue> | null
  word_count: number
  char_count: number
  paste_word_count: number | null
  keystroke_count: number | null
  trigger: TestAttemptHistoryTrigger
  created_at: string
}

// Extended quiz types for UI
export interface QuizWithQuestions extends Quiz {
  questions: QuizQuestion[]
}

export interface QuizWithStats extends Quiz {
  stats: {
    total_students: number
    responded: number
    submitted?: number
    open_access?: number
    closed_access?: number
    questions_count: number
  }
}

export interface AssessmentEditorSummaryUpdate {
  title: string
  show_results: boolean
  questions_count: number
}

export interface AssessmentWorkspaceSummaryPatch extends Partial<AssessmentEditorSummaryUpdate> {
  status?: QuizStatus
}

export type StudentQuizStatus = 'not_started' | 'responded' | 'can_view_results'

export interface StudentQuizView extends Quiz {
  student_status: StudentQuizStatus
  questions?: QuizQuestion[]
  focus_summary?: QuizFocusSummary | null
}

export interface QuizResultsAggregate {
  question_id: string
  question_text: string
  options: string[]
  counts: number[] // count per option, same index
  total_responses: number
}

// Log summary types
export interface LogSummaryActionItem {
  text: string
  studentName: string
}

export interface LogSummary {
  id: string
  classroom_id: string
  date: string
  summary_items: { overview: string; action_items: { text: string; initials: string }[] }
  initials_map: Record<string, string>
  entry_count: number
  entries_updated_at: string | null
  model: string
  generated_at: string
  created_at: string
}

// Announcement types
export interface Announcement {
  id: string
  classroom_id: string
  content: string
  created_by: string
  scheduled_for: string | null // NULL = published immediately, future timestamp = scheduled
  created_at: string
  updated_at: string
}

export interface ClassworkMaterial {
  id: string
  classroom_id: string
  title: string
  content: TiptapContent
  is_draft: boolean
  released_at: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface LinkedBlueprintClassroom {
  id: string
  title: string
  class_code: string
  term_label: string | null
  actual_site_slug: string | null
  actual_site_published: boolean
  archived_at: string | null
  created_at: string
  updated_at: string
}

export type BlueprintMergeSuggestionArea =
  | 'overview'
  | 'outline'
  | 'resources'
  | 'assignments'
  | 'quizzes'
  | 'tests'
  | 'lesson-plans'
  | 'announcements'

export type BlueprintMergeSuggestionOperation = 'add' | 'update' | 'remove'

export interface BlueprintMergeSuggestionItem {
  key: string
  label: string
  operation: BlueprintMergeSuggestionOperation
  current_summary: string
  proposed_summary: string
}

export interface BlueprintMergeSuggestion {
  area: BlueprintMergeSuggestionArea
  title: string
  summary: string
  items: BlueprintMergeSuggestionItem[]
  preview_markdown?: string
}

export interface BlueprintMergeSuggestionSet {
  classroom_id: string
  classroom_title: string
  blueprint_id: string
  generated_at: string
  suggestions: BlueprintMergeSuggestion[]
}

export interface GradebookSettings {
  classroom_id: string
  use_weights: boolean
  assignments_weight: number
  quizzes_weight: number
  tests_weight: number
}

export interface GradebookStudentSummary {
  student_id: string
  student_email: string
  student_first_name: string | null
  student_last_name: string | null
  assignments_earned: number | null
  assignments_possible: number | null
  assignments_percent: number | null
  quizzes_earned: number | null
  quizzes_possible: number | null
  quizzes_percent: number | null
  tests_earned: number | null
  tests_possible: number | null
  tests_percent: number | null
  final_percent: number | null
}

export interface GradebookAssignmentDetail {
  assignment_id: string
  title: string
  due_at: string
  is_draft: boolean
  earned: number | null
  possible: number
  percent: number | null
  is_graded: boolean
}

export interface GradebookQuizDetail {
  quiz_id: string
  title: string
  earned: number
  possible: number
  percent: number
  status: 'draft' | 'active' | 'closed' | null
  is_manual_override: boolean
}

export interface GradebookTestDetail {
  test_id: string
  title: string
  earned: number
  possible: number
  percent: number
  status: 'draft' | 'active' | 'closed' | null
}

export interface GradebookStudentDetail extends GradebookStudentSummary {
  assignments: GradebookAssignmentDetail[]
  quizzes: GradebookQuizDetail[]
  tests: GradebookTestDetail[]
}

export interface GradebookClassAssignmentSummary {
  assignment_id: string
  title: string
  due_at: string
  is_draft: boolean
  possible: number
  graded_count: number
  average_percent: number | null
  median_percent: number | null
}

export interface GradebookClassQuizSummary {
  quiz_id: string
  title: string
  status: 'draft' | 'active' | 'closed' | null
  possible: number
  scored_count: number
  average_percent: number | null
}

export interface GradebookClassTestSummary {
  test_id: string
  title: string
  status: 'draft' | 'active' | 'closed' | null
  possible: number
  scored_count: number
  average_percent: number | null
}

export interface GradebookClassSummary {
  total_students: number
  students_with_final: number
  average_final_percent: number | null
  assignments: GradebookClassAssignmentSummary[]
  quizzes: GradebookClassQuizSummary[]
  tests: GradebookClassTestSummary[]
}

export type ReportCardTerm = 'midterm' | 'final'
