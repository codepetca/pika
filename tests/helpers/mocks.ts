/**
 * Mock factories and test data builders
 * Provides reusable mock objects for testing throughout the application
 */

import type { Entry, Assignment, AssignmentDoc, Classroom, Student, Teacher } from '@/types'

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
  due_at: '2024-10-20T23:59:59-04:00',
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
  content: 'This is my assignment submission.',
  is_submitted: false,
  submitted_at: null,
  created_at: '2024-10-15T10:00:00Z',
  updated_at: '2024-10-15T10:00:00Z',
  ...overrides,
})

/**
 * Create a mock classroom with default or custom values
 */
export const createMockClassroom = (overrides: Partial<Classroom> = {}): Classroom => ({
  id: 'classroom-1',
  title: 'GLD2O - Learning Strategies',
  class_code: 'ABC123',
  term_label: 'Fall 2024',
  created_by: 'teacher-1',
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
  email: 'jane.smith@gapps.yrdsb.ca',
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
  email: role === 'student' ? 'test@student.com' : 'test@gapps.yrdsb.ca',
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
// Common Test Data Sets
// ============================================================================

/**
 * Collection of mock entries for testing attendance calculations
 */
export const mockEntriesSet = {
  onTime: createMockEntry({
    id: 'entry-on-time',
    date: '2024-10-15',
    on_time: true,
    updated_at: '2024-10-15T22:00:00Z',
  }),
  late: createMockEntry({
    id: 'entry-late',
    date: '2024-10-16',
    on_time: false,
    updated_at: '2024-10-17T01:00:00Z',
  }),
  future: createMockEntry({
    id: 'entry-future',
    date: '2024-12-01',
    on_time: true,
    updated_at: '2024-12-01T20:00:00Z',
  }),
}

/**
 * Collection of mock assignments with various statuses
 */
export const mockAssignmentsSet = {
  notStarted: createMockAssignment({
    id: 'assignment-not-started',
    due_at: '2024-10-25T23:59:59-04:00',
  }),
  inProgress: createMockAssignment({
    id: 'assignment-in-progress',
    due_at: '2024-10-25T23:59:59-04:00',
  }),
  overdue: createMockAssignment({
    id: 'assignment-overdue',
    due_at: '2024-10-10T23:59:59-04:00',
  }),
  submitted: createMockAssignment({
    id: 'assignment-submitted',
    due_at: '2024-10-25T23:59:59-04:00',
  }),
}

/**
 * Collection of mock assignment docs with various statuses
 */
export const mockAssignmentDocsSet = {
  notStarted: null, // No doc exists
  inProgress: createMockAssignmentDoc({
    id: 'doc-in-progress',
    content: 'Work in progress...',
    is_submitted: false,
    submitted_at: null,
  }),
  submittedOnTime: createMockAssignmentDoc({
    id: 'doc-submitted-on-time',
    content: 'Completed assignment.',
    is_submitted: true,
    submitted_at: '2024-10-18T20:00:00Z',
  }),
  submittedLate: createMockAssignmentDoc({
    id: 'doc-submitted-late',
    content: 'Completed assignment (late).',
    is_submitted: true,
    submitted_at: '2024-10-26T10:00:00Z',
  }),
}

/**
 * Mock classroom with students for roster tests
 */
export const mockClassroomWithStudents = {
  classroom: createMockClassroom({
    id: 'classroom-with-students',
    title: 'Test Classroom',
  }),
  students: [
    createMockStudent({
      id: 'student-1',
      email: 'student1@example.com',
      first_name: 'Alice',
      last_name: 'Anderson',
    }),
    createMockStudent({
      id: 'student-2',
      email: 'student2@example.com',
      first_name: 'Bob',
      last_name: 'Brown',
    }),
    createMockStudent({
      id: 'student-3',
      email: 'student3@example.com',
      first_name: 'Charlie',
      last_name: 'Chen',
    }),
  ],
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Common email addresses for testing email validation
 */
export const TEST_EMAILS = {
  student: 'test@student.com',
  teacherYRDSB: 'teacher@gapps.yrdsb.ca',
  teacherYRDSBDirect: 'teacher@yrdsb.ca',
  invalid: 'not-an-email',
  empty: '',
  withSpaces: '  test@student.com  ',
}

/**
 * Common passwords for testing password validation
 */
export const TEST_PASSWORDS = {
  valid: 'SecurePass123',
  tooShort: 'Short1',
  empty: '',
  long: 'ThisIsAVeryLongPasswordThatShouldStillWork123!',
}

/**
 * Common verification codes for testing
 */
export const TEST_CODES = {
  valid: '12345',
  validSixDigit: '123456',
  invalid: 'ZZZZZ',
  empty: '',
  tooShort: '123',
  tooLong: '1234567890',
}
