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

export interface Classroom {
  id: string
  teacher_id: string
  title: string
  class_code: string
  term_label: string | null
  allow_enrollment: boolean
  start_date: string | null // YYYY-MM-DD, inclusive
  end_date: string | null // YYYY-MM-DD, inclusive
  lesson_plan_visibility: LessonPlanVisibility
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface LessonPlan {
  id: string
  classroom_id: string
  date: string // YYYY-MM-DD
  content: TiptapContent
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

// Assignment types
export interface Assignment {
  id: string
  classroom_id: string
  title: string
  description: string
  rich_instructions: TiptapContent | null  // Rich text instructions
  due_at: string  // ISO 8601 timestamp
  position: number
  is_draft: boolean  // Whether assignment is a draft (not visible to students)
  released_at: string | null  // When the assignment was released to students
  track_authenticity: boolean
  created_by: string
  created_at: string
  updated_at: string
}

export interface AuthenticityFlag {
  timestamp: string
  wordDelta: number
  seconds: number
  wps: number
  reason: 'paste' | 'low_keystrokes' | 'high_wps'
}

export interface AssignmentDoc {
  id: string
  assignment_id: string
  student_id: string
  content: TiptapContent  // Rich text content (JSONB)
  is_submitted: boolean
  submitted_at: string | null
  viewed_at: string | null
  score_completion: number | null
  score_thinking: number | null
  score_workflow: number | null
  feedback: string | null
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

/**
 * Info about a selected student in teacher assignments view.
 * Used to display student work in the right sidebar.
 */
export interface SelectedStudentInfo {
  assignmentId: string
  assignmentTitle: string
  studentId: string
  canGoPrev: boolean
  canGoNext: boolean
  onGoPrev: () => void
  onGoNext: () => void
}

export interface ClassroomResources {
  id: string
  classroom_id: string
  content: TiptapContent
  updated_at: string
  updated_by: string | null
}

// Quiz types
export type QuizStatus = 'draft' | 'active' | 'closed'

export interface Quiz {
  id: string
  classroom_id: string
  title: string
  status: QuizStatus
  show_results: boolean
  position: number
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

// Extended quiz types for UI
export interface QuizWithQuestions extends Quiz {
  questions: QuizQuestion[]
}

export interface QuizWithStats extends Quiz {
  stats: {
    total_students: number
    responded: number
    questions_count: number
  }
}

export type StudentQuizStatus = 'not_started' | 'responded' | 'can_view_results'

export interface StudentQuizView extends Quiz {
  student_status: StudentQuizStatus
  questions?: QuizQuestion[]
}

export interface QuizResultsAggregate {
  question_id: string
  question_text: string
  options: string[]
  counts: number[] // count per option, same index
  total_responses: number
}
