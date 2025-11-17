export type UserRole = 'student' | 'teacher'

export type AttendanceStatus = 'present' | 'late' | 'absent'

export type MoodEmoji = '😊' | '🙂' | '😐' | '😟' | '😢'

export interface User {
  id: string
  email: string
  role: UserRole
  email_verified_at: string | null
  password_hash: string | null
  created_at: string
}

export interface LoginCode {
  id: string
  email: string
  code_hash: string
  expires_at: string
  used: boolean
  attempts: number
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

export interface ClassDay {
  id: string
  course_code: string
  date: string  // YYYY-MM-DD
  prompt_text: string | null
  is_class_day: boolean
}

export interface Entry {
  id: string
  student_id: string
  course_code: string
  date: string  // YYYY-MM-DD
  text: string
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
  dates: Record<string, AttendanceStatus>  // date -> status
  summary: {
    present: number
    late: number
    absent: number
  }
}

export type Semester = 'semester1' | 'semester2'

export interface SemesterRange {
  start: string  // MM-DD
  end: string    // MM-DD
}
