import { describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { readContextualAssignmentList } from '@/lib/server/contextual-assignment-list-read'
import type { Database } from '@/types/database'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const now = new Date('2026-10-03T12:00:00.123Z')
const stamp = '2026-10-01T12:00:00Z'
const assignment = (n: number) => ({ id: id(n), classroom_id: classroomId, position: n, title: 'Essay', description: '', due_at: stamp,
  created_by: otherId, created_at: stamp, updated_at: stamp, is_draft: false, released_at: null, instructions_markdown: 'Hello', rich_instructions: null,
  artifact_id: id(n + 10000), source_artifact_id: null, source_blueprint_version_id: null, blueprint_archived_at: null,
  points_possible: 30, gradebook_category_id: null, gradebook_maximum_override: null, gradebook_score_scale: 1, gradebook_weight: 1, include_in_final: true, track_authenticity: true })
const requirement = (n: number) => ({ id: id(n + 20000), assignment_id: id(1), artifact_id: id(n + 30000), type: 'link', label: 'Evidence', instructions: '', required: true,
  position: n, created_at: stamp, updated_at: stamp, source_artifact_id: null, source_blueprint_version_id: null, validation_policy_json: {} })
const doc = (n: number, member = false) => ({ id: id(n + 40000), assignment_id: id(1), student_id: member ? actorId : id(n + 50000),
  is_submitted: true, submitted_at: stamp, returned_at: null, teacher_cleared_at: null,
  ...(member ? { content: { type: 'doc', content: [] }, content_legacy: '', created_at: stamp, updated_at: stamp, viewed_at: null,
    feedback_returned_at: null, github_username: null, repo_url: null, save_sequence: null, save_session_id: null } :
    { participant: { id: id(n + 50000), enrollment: [{ classroom_id: classroomId, student_id: id(n + 50000) }] } }) })

function fixture(options: { member?: boolean; archived?: string | null; feature?: unknown; assignments?: unknown[]; requirements?: unknown[]; docs?: unknown[]; grades?: unknown[]; feedback?: unknown[];
  intercept?: (row: unknown, url: URL, index: number) => unknown } = {}) {
  const urls: URL[] = []
  const root = { id: classroomId, teacher_id: options.member ? otherId : actorId, archived_at: options.archived ?? null }
  const membership = [{ classroom_id: classroomId, student_id: actorId }]
  const assignments = options.assignments ?? [assignment(1)]
  const fetcher = vi.fn(async (request: RequestInfo | URL) => {
    const url = new URL(String(request)); urls.push(url)
    const select = url.searchParams.get('select') ?? ''
    const after = (key: string) => url.searchParams.getAll(key).find(value => value.startsWith('gt.'))?.slice(3) ?? ''
    let row: unknown
    if (select === 'id,teacher_id,archived_at') row = root
    else {
      const base = { ...root, feature_visibility: options.feature ?? {}, ...(options.member ? { membership } : {}) }
      if (!select.includes('assignments:')) {
        row = select.includes('enrollments:') ? { ...base, enrollments: (options.docs ?? []).filter((d: any) => d.student_id > after('enrollments.student_id')).slice(0, 1000).map((d: any) => ({ classroom_id: classroomId, student_id: d.student_id })) } : base
      } else if (select.includes('docs:') || select.includes('requirements:')) {
        const kind = select.includes('requirements:') ? 'requirements' : 'docs'
        const collection = kind === 'requirements' ? options.requirements ?? [] : select.includes('score_completion') ? options.grades ?? [] : select.includes(',feedback)') ? options.feedback ?? [] : options.docs ?? []
        const scoped = (url.searchParams.get('assignments.id') ?? '').slice(4, -1).split(',')
        row = { ...base, assignments: assignments.filter((a: any) => scoped.includes(a.id)).map((a: any) => ({ id: a.id, classroom_id: a.classroom_id, is_draft: a.is_draft, released_at: a.released_at,
          [kind]: collection.filter((d: any) => d.assignment_id === a.id && d.id > after(`assignments.${kind}.id`)).slice(0, Number(url.searchParams.get(`assignments.${kind}.limit`))) })) }
      } else row = { ...base, assignments: assignments.filter((a: any) => a.id > after('assignments.id')).slice(0, 1000) }
    }
    if (options.intercept) row = options.intercept(row, url, urls.length - 1)
    return new Response(JSON.stringify(row), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  const supabase = createClient<Database>('http://127.0.0.1:54321', 'fake-key', { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } })
  return { supabase, urls, fetcher, read: () => readContextualAssignmentList({ supabase, actorId, classroomId, permission: options.member ? 'member' : 'owner', now }) }
}

describe('current assignment list statements using the installed SDK offline', () => {
  it.each([false, true])('proves root authority on every payload and terminal query (member=%s)', async member => {
    const f = fixture({ member, docs: [doc(1, member)] })
    const result = await f.read()
    expect(result.assignments).toHaveLength(1)
    for (const url of f.urls.slice(1)) {
      expect(url.searchParams.get('teacher_id')).toBe(`${member ? 'neq' : 'eq'}.${actorId}`)
      expect(url.searchParams.get('id')).toBe(`eq.${classroomId}`)
      expect(url.searchParams.get('select')).not.toContain('*')
      if (member) {
        expect(url.searchParams.get('membership.student_id')).toBe(`eq.${actorId}`)
        expect(url.searchParams.get('archived_at')).toBe('is.null')
        if (url.searchParams.get('select')?.includes('assignments:')) expect(url.searchParams.get('feature_visibility')).toBe('eq.{}')
      }
    }
    if (member) expect(result.assignments[0]).toMatchObject({ status: 'submitted_on_time', doc: { score_completion: null, graded_at: null, feedback: null } })
    else expect(result.assignments[0]).toMatchObject({ instructions_markdown: 'Hello', stats: { total_students: 1 }, submission_requirements: [] })
  })
  it.each([2, 3, 4, 5])('discards the response on first/later/terminal revocation at statement %s', async index => {
    await expect(fixture({ intercept: (row, _url, n) => n === index ? null : row }).read()).rejects.toMatchObject({ statusCode: 403 })
  })
  it('fully paginates >1000 assignments, enrollments, docs and requirements', async () => {
    const f = fixture({ assignments: Array.from({ length: 1001 }, (_, n) => assignment(n + 1)), docs: Array.from({ length: 1001 }, (_, n) => doc(n + 1)), requirements: Array.from({ length: 1001 }, (_, n) => requirement(n + 1)) })
    const result = await f.read()
    expect(result.assignments).toHaveLength(1001)
    expect(result.assignments[0]).toMatchObject({ stats: { total_students: 1001, submitted: 1001 }, submission_requirements: expect.any(Array) })
    expect((result.assignments[0] as any).submission_requirements).toHaveLength(1001)
  })
  it('allows archived owner reads; denies archived/hidden member and self-owner participation', async () => {
    await expect(fixture({ archived: stamp }).read()).resolves.toHaveProperty('assignments')
    await expect(fixture({ member: true, archived: stamp }).read()).rejects.toMatchObject({ statusCode: 403 })
    await expect(fixture({ member: true, feature: { classwork: false } }).read()).rejects.toMatchObject({ statusCode: 403 })
    const f = fixture()
    await expect(readContextualAssignmentList({ supabase: f.supabase, actorId, classroomId, permission: 'member' })).rejects.toMatchObject({ statusCode: 403 })
  })
  it.each([{ classroom_id: otherId }, { is_draft: true }, { released_at: '2026-10-04T12:00:00Z' }, { ai_grading_review: {} }])('rejects wrong-scope/unpublished/widened assignment DTO %#', async patch => {
    await expect(fixture({ member: true, assignments: [{ ...assignment(1), ...patch }] }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('rejects noncurrent student stats before using the payload', async () => {
    await expect(fixture({ docs: [{ ...doc(1), participant: { id: id(50001), enrollment: [{ classroom_id: otherId, student_id: id(50001) }] } }] }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('fails uncertain transport without retry or query fallback', async () => {
    const f = fixture(); f.fetcher.mockRejectedValue(new Error('private backend detail'))
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
    expect(f.fetcher).toHaveBeenCalledTimes(1)
  })
  it.each([true, false])('repeats current publication and precise captured cutoff on every member parent page (returned=%s)', async returned => {
    const base = { ...doc(1, true), returned_at: returned ? stamp : null }
    const grade = { id: base.id, assignment_id: id(1), student_id: actorId, returned_at: stamp, score_completion: 0, score_thinking: null, score_workflow: null, graded_at: stamp, graded_by: otherId }
    const feedback = { id: base.id, assignment_id: id(1), student_id: actorId, returned_at: stamp, feedback_returned_at: null, feedback: 'Released' }
    const f = fixture({ member: true, docs: [base], grades: [grade], feedback: [feedback] })
    const result = await f.read()
    expect(result.assignments[0]).toMatchObject({ doc: { score_completion: returned ? 0 : null, score_thinking: null, feedback: returned ? 'Released' : null, authenticity_flags: null, ai_feedback_suggestion: null } })
    for (const url of f.urls.filter(url => url.searchParams.get('select')?.includes('assignments:'))) {
      expect(url.searchParams.get('assignments.is_draft')).toBe('eq.false')
      expect(url.searchParams.get('assignments.or')).toContain('released_at.lt.2026-10-03T12:00:00.124Z')
      if (url.searchParams.get('select')?.includes('score_completion')) expect(url.searchParams.get('assignments.docs.returned_at')).toBe('not.is.null')
      expect(url.searchParams.get('select')).not.toMatch(/authenticity_score|authenticity_flags|ai_feedback|teacher_feedback|ai_grading/)
    }
  })
  it('releases feedback independently while leaving blank unreturned rubric fields null', async () => {
    const base = { ...doc(1, true), feedback_returned_at: stamp }
    const f = fixture({ member: true, docs: [base], feedback: [{ id: base.id, assignment_id: id(1), student_id: actorId, returned_at: null, feedback_returned_at: stamp, feedback: 'Comment' }] })
    expect((await f.read()).assignments[0]).toMatchObject({ doc: { feedback: 'Comment', score_completion: null, graded_at: null } })
    expect(f.urls.some(url => url.searchParams.get('select')?.includes('score_completion'))).toBe(false)
  })
  it('rejects return retraction and grade-document substitution before disclosure', async () => {
    const base = { ...doc(1, true), returned_at: stamp }
    const grade = { id: base.id, assignment_id: id(1), student_id: actorId, returned_at: stamp, score_completion: 0, score_thinking: 0, score_workflow: 0, graded_at: stamp, graded_by: otherId }
    for (const grades of [[], [{ ...grade, id: id(999) }], [{ ...grade, returned_at: null }]]) {
      await expect(fixture({ member: true, docs: [base], grades }).read()).rejects.toMatchObject({ statusCode: 503 })
    }
  })
  it.each([2, 3, 4, 5, 6])('rejects member revocation on collection/page/empty-terminal/final query %s', async index => {
    await expect(fixture({ member: true, docs: [doc(1, true)], intercept: (row, _url, n) => n === index ? null : row }).read()).rejects.toMatchObject({ statusCode: 403 })
  })
  it.each([{ membership: [] }, { membership: [{ classroom_id: otherId, student_id: actorId }] }, { membership: [{ classroom_id: classroomId, student_id: otherId }] }, { teacher_id: actorId }, { archived_at: stamp }])('rejects substituted member relationship %#', async patch => {
    await expect(fixture({ member: true, intercept: (row, _url, n) => n === 2 ? { ...Object(row), ...patch } : row }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each([null, undefined, {}, { feedback: 'private' }])('rejects absent or malformed child collection %#', async docs => {
    await expect(fixture({ intercept: (row, url) => url.searchParams.get('select')?.includes('docs:') ? { ...Object(row), assignments: [{ id: id(1), classroom_id: classroomId, is_draft: false, released_at: null, docs }] } : row }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('binds every requirement to its parent and excludes owner self-enrollment docs', async () => {
    await expect(fixture({ requirements: [{ ...requirement(1), assignment_id: id(2) }], intercept: (row, url) => {
      if (url.searchParams.get('select')?.includes('requirements:')) return { ...Object(row), assignments: [{ id: id(1), classroom_id: classroomId, is_draft: false, released_at: null, requirements: [{ ...requirement(1), assignment_id: id(2) }] }] }
      return row
    } }).read()).rejects.toMatchObject({ statusCode: 503 })
    const bad = { ...doc(1), student_id: actorId, participant: { id: actorId, enrollment: [{ classroom_id: classroomId, student_id: actorId }] } }
    await expect(fixture({ docs: [bad] }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('rejects same-page duplicate or backward assignment identities', async () => {
    for (const rows of [[assignment(1), assignment(1)], [assignment(2), assignment(1)]]) {
      await expect(fixture({ assignments: rows }).read()).rejects.toMatchObject({ statusCode: 503 })
    }
  })
  it('aborts transports ignoring cancellation at the bounded deadline', async () => {
    vi.useFakeTimers()
    try {
      const f = fixture(); f.fetcher.mockImplementation(() => new Promise<Response>(() => {}))
      const result = expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
      await vi.advanceTimersByTimeAsync(20000); await result
      expect(f.fetcher).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })
  it('denies foreign owners and grants no membership to a cohort-only actor', async () => {
    const owner = fixture({ member: true })
    await expect(readContextualAssignmentList({ supabase: owner.supabase, actorId, classroomId, permission: 'owner' })).rejects.toMatchObject({ statusCode: 403 })
    await expect(fixture({ member: true, intercept: (row, _url, n) => n === 1 ? null : row }).read()).rejects.toMatchObject({ statusCode: 403 })
  })
  it('rejects malformed identity/clock before any database query', async () => {
    const f = fixture()
    await expect(readContextualAssignmentList({ supabase: f.supabase, actorId: 'bad', classroomId, permission: 'owner' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(readContextualAssignmentList({ supabase: f.supabase, actorId, classroomId, permission: 'owner', now: new Date('invalid') })).rejects.toMatchObject({ statusCode: 503 })
    expect(f.fetcher).not.toHaveBeenCalled()
  })
})
