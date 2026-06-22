import type {
  TestAiGradingRunSummary,
  TestAssessment,
  TestFocusSummary,
} from '@/types'

/**
 * Tests are the active product surface, but these routes still emit legacy
 * quiz-shaped keys for older clients during the contract transition.
 */
export function withLegacyQuizListKey<T>(tests: T[]): { tests: T[]; quizzes: T[] } {
  return {
    tests,
    quizzes: tests,
  }
}

export function withLegacyQuizKey<T>(test: T): { test: T; quiz: T } {
  return {
    test,
    quiz: test,
  }
}

type TestApiListPayload<T> = {
  tests?: T[] | null
  quizzes?: T[] | null
}

type TestApiDetailPayload<T> = {
  test?: T | null
  quiz?: T | null
}

export function readTestsFromPayload<T>(payload: TestApiListPayload<T> | null | undefined): T[] {
  return payload?.tests ?? payload?.quizzes ?? []
}

export function readTestFromPayload<T>(payload: TestApiDetailPayload<T> | null | undefined): T | undefined {
  return payload?.test ?? payload?.quiz ?? undefined
}

export interface TeacherTestGradingStudentRow {
  student_id: string
  name: string | null
  first_name: string | null
  last_name: string | null
  email: string
  status: 'not_started' | 'in_progress' | 'closed' | 'submitted' | 'returned'
  submitted_at: string | null
  closed_for_grading_at?: string | null
  last_activity_at: string | null
  points_earned: number
  points_possible: number
  percent: number | null
  graded_open_responses: number
  ungraded_open_responses: number
  access_state?: 'open' | 'closed' | null
  effective_access?: 'open' | 'closed'
  access_source?: 'test' | 'student'
  focus_summary: TestFocusSummary | null
}

export interface TeacherTestGradingQuestionSummary {
  id: string
  questionType: 'multiple_choice' | 'open_response'
  responseMonospace: boolean
}

type TeacherTestResultsQuestionPayload = {
  id: string
  question_type?: unknown
  response_monospace?: unknown
}

export type TeacherTestResultsPayload = TestApiDetailPayload<TestAssessment> & {
  students?: TeacherTestGradingStudentRow[]
  questions?: TeacherTestResultsQuestionPayload[]
  active_ai_grading_run?: TestAiGradingRunSummary | null
  error?: string
}

export type TeacherTestResults = {
  test: TestAssessment | undefined
  testStatus: TestAssessment['status'] | null
  students: TeacherTestGradingStudentRow[]
  questions: TeacherTestGradingQuestionSummary[]
  activeAiGradingRun: TestAiGradingRunSummary | null
  error?: string
}

function readTeacherTestStatus(test: TestAssessment | undefined): TestAssessment['status'] | null {
  return test?.status === 'draft' || test?.status === 'active' || test?.status === 'closed'
    ? test.status
    : null
}

export function readTeacherTestResultsFromPayload(
  payload: TeacherTestResultsPayload | null | undefined,
): TeacherTestResults {
  const test = readTestFromPayload<TestAssessment>(payload)
  return {
    test,
    testStatus: readTeacherTestStatus(test),
    students: payload?.students || [],
    questions: Array.isArray(payload?.questions)
      ? payload.questions.map((question) => ({
          id: String(question.id),
          questionType: question.question_type === 'open_response' ? 'open_response' : 'multiple_choice',
          responseMonospace: question.response_monospace === true,
        }))
      : [],
    activeAiGradingRun: payload?.active_ai_grading_run ?? null,
    error: payload?.error,
  }
}
