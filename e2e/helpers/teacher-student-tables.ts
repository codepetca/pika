import type { Page } from '@playwright/test'

export type TeacherStudentTable = 'roster' | 'gradebook' | 'assignment' | 'test' | 'attendance'
export const LONG_ROSTER_SIZE = 45
export const TABLE_CLASSROOM_ID = '30000000-0000-4000-8000-000000000011'
const assignmentId = '30000000-0000-4000-8000-000000000014'
const testId = '30000000-0000-4000-8000-000000000013'
const attendanceClassroomId = '30000000-0000-4000-8000-000000000001'
const students = Array.from({ length: LONG_ROSTER_SIZE }, (_, index) => ({
  id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  first: `Student ${String(index + 1).padStart(2, '0')}`,
  last: `Alpha${String(index + 1).padStart(2, '0')}`,
  email: `student${index + 1}@example.invalid`,
}))

export async function mockTableShellReads(page: Page, role: 'teacher' | 'student' = 'teacher') {
  const user = { id: role === 'teacher' ? '30000000-0000-4000-8000-000000000012' : '30000000-0000-4000-8000-000000000015',
    email: `${role}@example.invalid`, role, first_name: 'Fixture', last_name: role }
  await page.route('**/api/**', async route => {
    if (route.request().method() !== 'GET') return route.abort()
    const url = new URL(route.request().url())
    let body: unknown = {}
    if (url.pathname === '/api/auth/me') body = { user }
    else if (url.pathname.endsWith('/class-days')) body = { class_days: Array.from({ length: 36 }, (_, index) => ({
      id: `50000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      classroom_id: TABLE_CLASSROOM_ID,
      date: new Date(Date.UTC(2026, 7, 17 - index)).toISOString().slice(0, 10),
      prompt_text: 'What is your plan today?', is_class_day: true,
    })) }
    else if (url.pathname.endsWith('/entries')) body = { entries: Array.from({ length: 35 }, (_, index) => ({
      id: `50000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      student_id: user.id, classroom_id: TABLE_CLASSROOM_ID,
      date: new Date(Date.UTC(2026, 7, 16 - index)).toISOString().slice(0, 10),
      text: `Past daily log ${index + 1}`, feedback: null,
      created_at: '2026-08-17T12:00:00Z', updated_at: '2026-08-17T12:00:00Z',
    })) }
    else if (url.pathname.endsWith('/assignments')) body = { assignments: [] }
    else if (url.pathname.endsWith('/announcements')) body = { announcements: [] }
    else if (url.pathname.endsWith('/lesson-plans')) body = { lesson_plans: [] }
    else if (url.pathname.endsWith('/materials')) body = { materials: [] }
    else if (url.pathname.endsWith('/notifications')) body = { notifications: [] }
    else if (url.pathname.endsWith('/history')) body = { history: [] }
    else if (url.pathname.endsWith('/classrooms')) body = { classrooms: [] }
    else if (url.pathname.endsWith('/email2')) body = { rows: [] }
    await route.fulfill({ json: body })
  })
}

/** Read-only, deterministic browser fixtures for production teacher table owners. */
export async function mockLongTeacherTable(page: Page, surface: TeacherStudentTable, classroomId: string) {
  const assignment = {
    id: assignmentId, classroom_id: classroomId, title: 'Long roster assignment',
    description: '', instructions_markdown: 'Explain your approach.', rich_instructions: null,
    due_at: null, position: 0, is_draft: false, released_at: '2026-01-01T12:00:00Z',
    created_by: '30000000-0000-4000-8000-000000000012',
    created_at: '2026-01-01T12:00:00Z', updated_at: '2026-01-01T12:00:00Z',
    stats: { total_students: LONG_ROSTER_SIZE, submitted_count: LONG_ROSTER_SIZE, graded_count: 0, returned_count: 0 },
  }
  const assessment = {
    id: testId, classroom_id: classroomId, title: 'Long roster test', description: null,
    instructions: null, status: 'active', show_results: false, position: 0, documents: [],
    created_at: '2026-08-27T12:00:00Z', updated_at: '2026-08-27T12:00:00Z',
    stats: { total_students: LONG_ROSTER_SIZE, responded: 0, submitted: 0, open_access: LONG_ROSTER_SIZE, closed_access: 0, questions_count: 1 },
  }
  await page.route('**/api/teacher/**', async (route) => {
    const url = new URL(route.request().url())
    let body: unknown
    if ((surface === 'roster' || surface === 'gradebook') && url.pathname === `/api/teacher/classrooms/${classroomId}/roster`) {
      body = { roster: students.map((student, index) => ({
        id: student.id, student_id: student.id, first_name: student.first, last_name: student.last,
        email: student.email, student_number: String(1000 + index), counselor_email: null,
        joined: true, join_source: 'csv', joined_at: '2026-08-17T12:00:00Z',
        created_at: '2026-08-17T12:00:00Z', updated_at: '2026-08-17T12:00:00Z',
      })) }
    } else if (surface === 'gradebook' && url.pathname === '/api/teacher/gradebook') {
      body = {
        categories: [], category_schema_available: true, score_overrides_available: true,
        items_available: true, maximum_overrides_available: true, maximum_edits_enabled: true,
        assessment_columns: [],
        students: students.map((student, index) => ({
          student_id: student.id, student_email: student.email,
          student_number: String(1000 + index), student_first_name: student.first,
          student_last_name: student.last, assignments_earned: 0, assignments_possible: 0,
          assignments_percent: null, tests_earned: 0, tests_possible: 0,
          tests_percent: null, final_percent: null, assessment_scores: [],
        })),
      }
    } else if (surface === 'assignment' && url.pathname === '/api/teacher/assignments') {
      body = { assignments: [assignment] }
    } else if (surface === 'assignment' && url.pathname === `/api/teacher/assignments/${assignmentId}`) {
      body = { assignment, active_ai_grading_run: null, students: students.map(student => ({
        student_id: student.id, student_email: student.email,
        student_first_name: student.first, student_last_name: student.last,
        status: 'submitted_on_time', student_updated_at: '2026-01-02T12:00:00Z', artifacts: [],
        doc: { submitted_at: '2026-01-02T12:00:00Z', updated_at: '2026-01-02T12:00:00Z',
          score_completion: null, score_thinking: null, score_workflow: null,
          graded_at: null, returned_at: null, feedback_returned_at: null },
      })) }
    } else if (surface === 'assignment' && url.pathname.startsWith(`/api/teacher/assignments/${assignmentId}/students/`)) {
      const student = students.find(item => url.pathname.endsWith(item.id))!
      body = { assignment, student: { id: student.id, email: student.email, name: `${student.first} ${student.last}` }, doc: null, feedback_entries: [] }
    } else if (surface === 'test' && url.pathname === '/api/teacher/tests') {
      body = { tests: [assessment] }
    } else if (surface === 'test' && url.pathname === `/api/teacher/tests/${testId}/results`) {
      body = { test: assessment, questions: [{ id: 'question-1', question_type: 'open_response',
        question_text: 'Explain your approach.', options: [], correct_option: null, points: 10 }],
        active_ai_grading_run: null, students: students.map(student => ({
          student_id: student.id, name: `${student.first} ${student.last}`,
          first_name: student.first, last_name: student.last, email: student.email,
          status: 'not_started', submitted_at: null, returned_at: null, last_activity_at: null,
          points_earned: 0, points_possible: 10, percent: null, graded_open_responses: 0,
          ungraded_open_responses: 0, answers: {}, access_state: null, effective_access: 'open', access_source: 'test',
          focus_summary: { away_count: 0, away_total_seconds: 0, route_exit_attempts: 0, window_unmaximize_attempts: 0 },
        })),
      }
    } else if (surface === 'attendance' && url.pathname === '/api/teacher/attendance/session') {
      body = { classroomId: attendanceClassroomId, classDate: '2026-08-17', integration: 'ready',
        session: { state: 'open', opensAt: '2026-08-17T04:45:00Z', closesAt: '2026-08-18T02:34:00Z',
          sessionStartsAt: '2026-08-17T12:55:00Z', sessionEndsAt: '2026-08-17T13:25:00Z',
          presentThroughAt: '2026-08-17T13:00:00Z', absentAt: '2026-08-17T13:25:00Z', revision: 1, commandFailed: false },
        sync: { state: 'current', confirmedAt: '2026-08-17T12:45:00Z' },
        students: students.map(student => ({ studentId: student.id, firstName: student.first, lastName: student.last,
          status: 'unmarked', source: null, checkedInAt: null, revision: null, hasQrCheckIn: false,
          hasManualOverride: false, pendingCommand: false, commandFailed: false })),
      }
    } else if (surface === 'attendance' && url.pathname === '/api/teacher/attendance/policy') {
      body = { policy: { classroomId: attendanceClassroomId, timezone: 'America/Toronto',
        sessionStartsLocal: '09:00', sessionEndsLocal: '10:00', sessionEndDayOffset: 0,
        entryOpensMinutesBefore: 10, presentGraceMinutes: 5, entryClosesMinutesBeforeEnd: 10,
        absentMinutesBeforeEnd: 0, enabled: true, revision: 1, updatedAt: '2026-08-17T12:00:00Z' } }
    }
    if (body === undefined) return route.fallback()
    // These scenarios inspect/select rows; they never submit grading or attendance changes.
    if (route.request().method() !== 'GET') return route.abort()
    await route.fulfill({ json: body })
  })
  const classroomRoute = `/classrooms/${classroomId}`
  return {
    roster: { route: `${classroomRoute}?tab=roster`, pane: 'roster-student-scroll-pane' },
    gradebook: { route: `${classroomRoute}?tab=gradebook`, pane: 'gradebook-student-scroll-pane' },
    assignment: { route: `${classroomRoute}?tab=assignments&assignmentId=${assignmentId}`, pane: 'assignment-student-scroll-pane' },
    test: { route: `${classroomRoute}?tab=tests&testId=${testId}&testMode=grading`, pane: 'test-grading-student-scroll-pane' },
    attendance: { route: '/e2e-fixtures/teacher-live-attendance', pane: 'attendance-student-scroll-pane' },
  }[surface]
}
