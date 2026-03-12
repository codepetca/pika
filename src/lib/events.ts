import type { AssignmentDoc } from '@/types'

/**
 * Custom event names used for cross-component communication.
 * Centralized here to avoid magic strings scattered across the codebase.
 */

/** Dispatched when class days are updated (created, toggled, etc.) */
export const CLASS_DAYS_UPDATED_EVENT = 'pika:classDaysUpdated'

/** Dispatched when teacher assignment selection changes */
export const TEACHER_ASSIGNMENTS_SELECTION_EVENT = 'pika:teacherAssignmentsSelection'

/** Dispatched when assignments are created, updated, or deleted */
export const TEACHER_ASSIGNMENTS_UPDATED_EVENT = 'pika:teacherAssignmentsUpdated'

/** Dispatched when quizzes are created, updated, or deleted */
export const TEACHER_QUIZZES_UPDATED_EVENT = 'pika:teacherQuizzesUpdated'

/** Dispatched when a student's grade is saved (manual or AI) in the sidebar */
export const TEACHER_GRADE_UPDATED_EVENT = 'pika:teacherGradeUpdated'

export interface TeacherGradeUpdatedEventDetail {
  assignmentId: string
  studentId: string
  doc: AssignmentDoc | null
}

/** Dispatched when a test student's grading row metrics are updated from the right grading panel */
export const TEACHER_TEST_GRADING_ROW_UPDATED_EVENT = 'pika:teacherTestGradingRowUpdated'

export interface TeacherTestGradingRowUpdatedEventDetail {
  testId: string
  studentId: string
  pointsEarned: number
  pointsPossible: number
  percent: number | null
  gradedOpenResponses: number
  ungradedOpenResponses: number
}

/** Dispatched when student test exam mode enters/exits an active attempt */
export const STUDENT_TEST_EXAM_MODE_CHANGE_EVENT = 'pika:studentTestExamModeChange'

/** Dispatched to request student test route-exit attempt telemetry */
export const STUDENT_TEST_ROUTE_EXIT_ATTEMPT_EVENT = 'pika:studentTestRouteExitAttempt'
