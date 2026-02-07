/**
 * Mock factories and test data builders
 * Provides reusable mock objects for testing throughout the application
 */

import type {
  Entry,
  Assignment,
  AssignmentDoc,
  Classroom,
  Student,
  Teacher,
  TiptapContent,
  Quiz,
  QuizQuestion,
  QuizResponse,
  UserPet,
  PetUnlock,
  XpEvent,
} from '@/types'

// ============================================================================
// Mock Data Factories
// ============================================================================

/**
 * Create a mock entry with default or custom values
 */
export const createMockEntry = (overrides: Partial<Entry> = {}): Entry => ({
  id: 'entry-1',
  student_id: 'student-1',
  classroom_id: 'classroom-1',
  date: '2024-10-15',
  text: 'This is a test journal entry for today.',
  rich_content: null,
  version: 1,
  minutes_reported: 60,
  mood: '😊',
  created_at: '2024-10-15T20:00:00Z',
  updated_at: '2024-10-15T20:00:00Z',
  on_time: true,
  ...overrides,
})

/**
 * Create a mock assignment with default or custom values
 */
export const createMockAssignment = (overrides: Partial<Assignment> = {}): Assignment => ({
  id: 'assignment-1',
  classroom_id: 'classroom-1',
  title: 'Test Assignment',
  description: 'Complete the reading and answer the questions.',
  rich_instructions: null,
  due_at: '2024-10-20T23:59:59-04:00',
  position: 0,
  created_by: 'teacher-1',
  created_at: '2024-10-10T10:00:00Z',
  updated_at: '2024-10-10T10:00:00Z',
  ...overrides,
})

/**
 * Create a mock assignment doc with default or custom values
 */
export const createMockAssignmentDoc = (overrides: Partial<AssignmentDoc> = {}): AssignmentDoc => ({
  id: 'doc-1',
  assignment_id: 'assignment-1',
  student_id: 'student-1',
  content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'This is my assignment submission.' }] }] },
  is_submitted: false,
  submitted_at: null,
  viewed_at: null,
  created_at: '2024-10-15T10:00:00Z',
  updated_at: '2024-10-15T10:00:00Z',
  ...overrides,
})

/**
 * Create a mock classroom with default or custom values
 */
export const createMockClassroom = (overrides: Partial<Classroom> = {}): Classroom => ({
  id: 'classroom-1',
  teacher_id: 'teacher-1',
  title: 'Test Classroom',
  class_code: 'TEST01',
  term_label: 'Fall 2024',
  allow_enrollment: true,
  start_date: null,
  end_date: null,
  lesson_plan_visibility: 'current_week',
  archived_at: null,
  created_at: '2024-09-01T10:00:00Z',
  updated_at: '2024-09-01T10:00:00Z',
  ...overrides,
})

/**
 * Create a mock student with default or custom values
 */
export const createMockStudent = (overrides: Partial<Student> = {}): Student => ({
  id: 'student-1',
  user_id: 'user-student-1',
  email: 'john.doe@student.com',
  first_name: 'John',
  last_name: 'Doe',
  created_at: '2024-09-01T09:00:00Z',
  updated_at: '2024-09-01T09:00:00Z',
  ...overrides,
})

/**
 * Create a mock teacher with default or custom values
 */
export const createMockTeacher = (overrides: Partial<Teacher> = {}): Teacher => ({
  id: 'teacher-1',
  user_id: 'user-teacher-1',
  email: 'teacher@example.com',
  first_name: 'Jane',
  last_name: 'Smith',
  created_at: '2024-08-15T09:00:00Z',
  updated_at: '2024-08-15T09:00:00Z',
  ...overrides,
})

/**
 * Create a mock user object (for sessions)
 */
export const createMockUser = (
  role: 'student' | 'teacher' = 'student',
  overrides: Record<string, any> = {}
) => ({
  id: role === 'student' ? 'user-student-1' : 'user-teacher-1',
  email: role === 'student' ? 'student1@example.com' : 'teacher@example.com',
  role,
  ...overrides,
})

/**
 * Create a mock session object
 */
export const createMockSession = (
  role: 'student' | 'teacher' = 'student',
  overrides: Record<string, any> = {}
) => ({
  user: createMockUser(role, overrides),
})

// ============================================================================
// Supabase Response Helpers
// ============================================================================

/**
 * Create a mock Supabase success response
 */
export const createMockSupabaseResponse = <T>(data: T, error: any = null) => ({
  data,
  error,
})

/**
 * Create a mock Supabase error response
 */
export const createMockSupabaseError = (message: string, code?: string) => ({
  data: null,
  error: {
    message,
    code: code || 'PGRST116',
    details: null,
    hint: null,
  },
})

// ============================================================================
// Date Helpers for Testing
// ============================================================================

/**
 * Convert ISO string to America/Toronto time
 * Useful for testing timezone-aware functions
 */
export const torontoTime = (isoString: string): Date => {
  return new Date(isoString)
}

/**
 * Create a date at midnight Toronto time for a given date string
 */
export const torontoMidnight = (dateString: string): string => {
  // Return ISO string for midnight in Toronto (23:59:59 on the date)
  return `${dateString}T23:59:59-04:00`
}

/**
 * Mock DST transition date helpers
 */
export const DST_SPRING_FORWARD_2024 = '2024-03-10T02:00:00-05:00' // 2 AM → 3 AM
export const DST_FALL_BACK_2024 = '2024-11-03T02:00:00-04:00' // 2 AM → 1 AM

// ============================================================================
// Quiz Mock Factories
// ============================================================================

/**
 * Create a mock quiz with default or custom values
 */
export const createMockQuiz = (overrides: Partial<Quiz> = {}): Quiz => ({
  id: 'quiz-1',
  classroom_id: 'classroom-1',
  title: 'Test Quiz',
  status: 'draft',
  show_results: false,
  position: 0,
  created_by: 'teacher-1',
  created_at: '2024-10-10T10:00:00Z',
  updated_at: '2024-10-10T10:00:00Z',
  ...overrides,
})

/**
 * Create a mock quiz question with default or custom values
 */
export const createMockQuizQuestion = (overrides: Partial<QuizQuestion> = {}): QuizQuestion => ({
  id: 'question-1',
  quiz_id: 'quiz-1',
  question_text: 'What is your favorite color?',
  options: ['Red', 'Blue', 'Green', 'Yellow'],
  position: 0,
  created_at: '2024-10-10T10:00:00Z',
  updated_at: '2024-10-10T10:00:00Z',
  ...overrides,
})

/**
 * Create a mock quiz response with default or custom values
 */
export const createMockQuizResponse = (overrides: Partial<QuizResponse> = {}): QuizResponse => ({
  id: 'response-1',
  quiz_id: 'quiz-1',
  question_id: 'question-1',
  student_id: 'student-1',
  selected_option: 0,
  submitted_at: '2024-10-15T14:30:00Z',
  ...overrides,
})

// ============================================================================
// Pet Mock Factories
// ============================================================================

/**
 * Create a mock user pet with default or custom values
 */
export const createMockUserPet = (overrides: Partial<UserPet> = {}): UserPet => ({
  id: 'pet-1',
  user_id: 'user-student-1',
  classroom_id: 'classroom-1',
  xp: 0,
  selected_image: 0,
  created_at: '2024-10-15T10:00:00Z',
  updated_at: '2024-10-15T10:00:00Z',
  ...overrides,
})

/**
 * Create a mock pet unlock with default or custom values
 */
export const createMockPetUnlock = (overrides: Partial<PetUnlock> = {}): PetUnlock => ({
  id: 'unlock-1',
  pet_id: 'pet-1',
  image_index: 0,
  unlocked_at: '2024-10-15T10:00:00Z',
  ...overrides,
})

/**
 * Create a mock XP event with default or custom values
 */
export const createMockXpEvent = (overrides: Partial<XpEvent> = {}): XpEvent => ({
  id: 'xp-event-1',
  pet_id: 'pet-1',
  source: 'daily_login',
  xp_amount: 10,
  metadata: null,
  created_at: '2024-10-15T10:00:00Z',
  ...overrides,
})
