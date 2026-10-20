import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { AuthorizationError } from '@/lib/auth'
import type { Database } from '@/types/database'
import type { Classroom } from '@/types'
import { invalidateCachedJSONMatching } from '@/lib/request-cache'
import { StudentAssignmentsTab } from '@/app/classrooms/[classroomId]/StudentAssignmentsTab'
import { GET as assignmentsGet } from '@/app/api/student/assignments/route'
import { GET as materialsGet } from '@/app/api/student/classrooms/[id]/materials/route'
import { GET as surveysGet } from '@/app/api/student/surveys/route'
import { GET as marksGet } from '@/app/api/student/classrooms/[id]/gradebook-items/route'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), role: vi.fn(), client: vi.fn() }))
vi.mock('@/lib/auth', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  requireAuth: mocks.auth, getCurrentUser: mocks.auth, requireRole: mocks.role,
}))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: mocks.client }))
// The summary and returned marks are real; the unopened rich editor is unrelated.
vi.mock('@/components/StudentAssignmentEditor', () => ({ StudentAssignmentEditor: () => null }))
vi.mock('@/components/editor', () => ({ RichTextViewer: () => null }))

// Exact class-B/memberTeacher IDs and persisted field shapes from the browser
// bootstrap, not a hand-authored StudentAssignmentsResponse bypassing services.
const actor = '50000000-0000-4000-8000-000000000013'
const owner = '50000000-0000-4000-8000-000000000012'
const classroomId = '50000000-0000-4000-8000-000000000022'
// Static parity with createContextualTestPlan/its app-environment serializer.
// Product tests deliberately do not import the separate private proof carrier;
// these literals are not evidence of the environment used by a spent attempt.
const actors = {
  ownerTeacher: '50000000-0000-4000-8000-000000000011', ownerStudent: owner,
  memberTeacher: actor, memberStudent: '50000000-0000-4000-8000-000000000014',
  nonmember: '50000000-0000-4000-8000-000000000015',
}
const classes = ['50000000-0000-4000-8000-000000000021', classroomId]
const id = (n: number) => `70000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const stamp = '2026-10-18T19:00:00.000Z'
const initialRevision = '2026-10-19T00:00:00.000Z'
const root = { id: classroomId, teacher_id: owner, archived_at: null }
const membership = [{ classroom_id: classroomId, student_id: actor }]
const visibility = { attendance: false, classwork: true, tests: true, gradebook: true, student_grades: true,
  calendar: false, syllabus: false, announcements: false, achievements: false,
  gradebook_hide_zero_weight_student: false, gradebook_compact_zero_weight_assessments: true }
const assignment = { id: id(202), classroom_id: classroomId, title: 'Gradebook Assignment B', description: '',
  instructions_markdown: 'Private synthetic instructions', rich_instructions: null, due_at: '2026-10-17T19:00:00.000Z',
  position: 0, is_draft: false, released_at: stamp, created_by: owner, created_at: stamp, updated_at: stamp,
  artifact_id: id(602), source_artifact_id: null, source_blueprint_version_id: null, blueprint_archived_at: null,
  points_possible: 30, gradebook_weight: 1, gradebook_category_id: id(102), gradebook_maximum_override: null,
  gradebook_score_scale: 1, include_in_final: true, track_authenticity: true }
const docIdentity = { id: id(402), assignment_id: assignment.id, student_id: actor }
const memberDoc = { ...docIdentity, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Private synthetic submission' }] }] },
  content_legacy: '', is_submitted: true, submitted_at: stamp, returned_at: stamp, feedback_returned_at: stamp,
  teacher_cleared_at: null, created_at: initialRevision, updated_at: initialRevision, viewed_at: null,
  github_username: null, repo_url: null, save_sequence: null, save_session_id: null }
const grade = { ...docIdentity, returned_at: stamp, score_completion: 7, score_thinking: 7, score_workflow: 7, graded_at: stamp, graded_by: owner }
const feedback = { ...docIdentity, returned_at: stamp, feedback_returned_at: stamp, feedback: 'Private synthetic feedback' }
const classroom = { ...root, title: 'Private Tests rehearsal B', class_code: 'SYNTHB', theme_color: 'blue',
  term_label: null, allow_enrollment: true, start_date: null, end_date: null, lesson_plan_visibility: 'hidden',
  created_at: stamp, updated_at: stamp, feature_visibility: visibility } satisfies Classroom
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

function installBackend(tamper?: 'assignment-peer' | 'marks-peer') {
  const urls: URL[] = []
  const backend = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)); urls.push(url)
    if (url.pathname.endsWith('/rpc/get_surveys_for_member_v1')) {
      expect(JSON.parse(String(init?.body))).toMatchObject({ p_actor_id: actor, p_classroom_id: classroomId })
      return json({ classroom: root, surveys: [] })
    }
    if (url.pathname.endsWith('/rpc/get_gradebook_for_member_v1')) {
      expect(JSON.parse(String(init?.body))).toMatchObject({ p_actor_id: actor, p_classroom_id: classroomId, p_view: 'items' })
      return json({ actor_id: actor, classroom: root, operation: 'member-items', source: {
        student_id: actor, visibility: { classwork: true, tests: true, student_grades: true, gradebook_compact_zero_weight_assessments: true },
        categories: [{ id: id(102), classroom_id: classroomId, name: 'Term', percentage: 100, default_assessment_weight: 10, position: 0, is_default: true }],
        assignments: [], assignment_docs: [], tests: [], test_questions: [], test_responses: [], test_attempts: [], score_overrides: [],
        items: [{ id: id(502), classroom_id: classroomId, title: 'Participation B', points_possible: 10, gradebook_weight: 1,
          gradebook_category_id: id(102), include_in_final: true, created_at: stamp, gradebook_maximum_override: null, gradebook_score_scale: 1 }],
        item_scores: [{ item_id: id(502), classroom_id: classroomId, student_id: tamper === 'marks-peer' ? owner : actor,
          earned: 6, returned_at: null, updated_at: stamp }],
      } })
    }
    const select = url.searchParams.get('select') ?? ''
    if (url.pathname.endsWith('/classroom_enrollments')) return json(membership[0])
    expect(url.pathname).toBe('/rest/v1/classrooms')
    if (select === 'id,teacher_id,archived_at') return json(root)
    if (select.includes('materials:')) return json({ ...root, membership, materials: [] })
    const base = { ...root, feature_visibility: visibility, membership }
    if (!select.includes('assignments:')) return json(base)
    if (!select.includes('docs:')) return json({ ...base, assignments: url.searchParams.get('assignments.id')?.startsWith('gt.') ? [] : [assignment] })
    const cursor = url.searchParams.get('assignments.docs.id')
    const rows = cursor ? [] : select.includes('score_completion') ? [{ ...grade, ...(tamper === 'assignment-peer' ? { student_id: owner } : {}) }]
      : select.includes(',feedback)') ? [feedback] : [memberDoc]
    return json({ ...base, assignments: [{ id: assignment.id, classroom_id: classroomId, is_draft: false, released_at: stamp, docs: rows }] })
  })
  const client = createClient<Database>('http://127.0.0.1:54321', 'offline-fixture-key', {
    global: { fetch: backend }, auth: { persistSession: false, autoRefreshToken: false },
  })
  mocks.client.mockReturnValue(client)
  return { backend, urls }
}

async function appGet(path: string) {
  const request = new NextRequest(`http://localhost${path}`)
  const context = { params: Promise.resolve({ id: classroomId }) }
  if (path.startsWith('/api/student/assignments?')) return assignmentsGet(request, context)
  if (path.startsWith('/api/student/surveys?')) return surveysGet(request, context)
  if (path.endsWith('/materials')) return materialsGet(request, context)
  if (path.endsWith('/gradebook-items')) return marksGet(request, context)
  throw new Error('Unexpected offline application request')
}

beforeEach(() => {
  vi.clearAllMocks(); invalidateCachedJSONMatching('student-')
  vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: Object.values(actors) }))
  vi.stubEnv('PIKA_CLASSROOM_PAGE_ACCESS_ENABLED', 'true')
  vi.stubEnv('PIKA_CLASSROOM_PAGE_ACCESS_PAIRS', JSON.stringify(Object.values(actors).flatMap(userId => classes.map(classroomId => ({ userId, classroomId })))))
  mocks.role.mockRejectedValue(new AuthorizationError('Forbidden: student role required'))
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('Classwork actual route/service/SDK/component integration for the class-B member', () => {
  it.each(['student', 'teacher'] as const)('renders returned marks with historical global role %s', async role => {
    mocks.auth.mockResolvedValue({ id: actor, role })
    const { backend } = installBackend()
    const paths = [`/api/student/assignments?classroom_id=${classroomId}`, `/api/student/classrooms/${classroomId}/materials`,
      `/api/student/surveys?classroom_id=${classroomId}`, `/api/student/classrooms/${classroomId}/gradebook-items`]
    const payloads = await Promise.all(paths.map(async path => {
      const response = await appGet(path)
      expect(response.status, path).toBe(200)
      return response.json()
    }))
    expect(payloads[0]).toMatchObject({ assignments: [{ id: assignment.id, doc: { ...grade, feedback: feedback.feedback } }] })
    expect(payloads[1]).toEqual({ materials: [] }); expect(payloads[2]).toEqual({ surveys: [] })
    expect(payloads[3]).toMatchObject({ items: [{ title: 'Participation B', earned: 6, possible: 10 }] })
    const requested: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input); requested.push(path)
      const response = await appGet(path)
      expect(response.status, path).toBe(200)
      return response
    }))
    render(<StudentAssignmentsTab classroom={classroom} />)
    expect(await screen.findByText('Gradebook Assignment B', { exact: true })).toBeVisible()
    const marks = await screen.findByRole('region', { name: 'Gradebook marks' })
    expect(within(marks).getByText('Participation B', { exact: true })).toBeVisible()
    expect(within(marks).getByText('6 / 10', { exact: true })).toBeVisible()
    expect(new Set(requested)).toEqual(new Set(paths))
    for (const privateText of ['Private synthetic submission', 'Private synthetic feedback', 'Private answer key', 'Private response']) {
      expect(screen.queryByText(privateText, { exact: true })).not.toBeInTheDocument()
    }
    expect(JSON.stringify(payloads[3])).not.toMatch(/student_id|feedback|content|answer_key|score_overrides/)
    expect(backend).toHaveBeenCalled(); expect(mocks.role).not.toHaveBeenCalled()
  })

  it.each(['assignment-peer', 'marks-peer'] as const)('fails closed before disclosing substituted %s data', async tamper => {
    mocks.auth.mockResolvedValue({ id: actor, role: 'teacher' }); installBackend(tamper)
    const path = tamper === 'assignment-peer' ? `/api/student/assignments?classroom_id=${classroomId}` : `/api/student/classrooms/${classroomId}/gradebook-items`
    const response = await appGet(path)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: tamper === 'assignment-peer' ? 'Unable to verify classroom assignments' : 'Gradebook operation unavailable' })
    expect(mocks.role).not.toHaveBeenCalled()
  })

  it('detects an omitted teacher actor in real admission configuration rather than mocking shared access', async () => {
    mocks.auth.mockResolvedValue({ id: actor, role: 'teacher' }); installBackend()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [owner] }))
    for (const path of [`/api/student/assignments?classroom_id=${classroomId}`, `/api/student/classrooms/${classroomId}/materials`,
      `/api/student/surveys?classroom_id=${classroomId}`, `/api/student/classrooms/${classroomId}/gradebook-items`]) {
      expect((await appGet(path)).status, path).toBe(403)
    }
    expect(mocks.role).toHaveBeenCalledWith('student')
  })
})
