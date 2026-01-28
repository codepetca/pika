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
