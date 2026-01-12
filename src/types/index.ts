import type { Operation } from 'fast-json-patch'

export type UserRole = 'student' | 'teacher'

export type AttendanceStatus = 'present' | 'absent'

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

export type FuturePlansVisibility = 'current' | 'next' | 'all'

export interface Classroom {
  id: string
  teacher_id: string
  title: string
  class_code: string
  term_label: string | null
  allow_enrollment: boolean
  start_date: string | null // YYYY-MM-DD, inclusive
  end_date: string | null // YYYY-MM-DD, inclusive
  future_plans_visibility: FuturePlansVisibility
  archived_at: string | null
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
  created_by: string
  created_at: string
  updated_at: string
}

export interface AssignmentDoc {
  id: string
  assignment_id: string
  student_id: string
  content: TiptapContent  // Rich text content (JSONB)
  is_submitted: boolean
  submitted_at: string | null
  viewed_at: string | null
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

// Daily Plans (Weekly Plan tab)
export interface DailyPlan {
  id: string
  classroom_id: string
  date: string // YYYY-MM-DD
  rich_content: TiptapContent
  created_at: string
  updated_at: string
}
