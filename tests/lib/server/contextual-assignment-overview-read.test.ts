import { describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { readContextualAssignmentOverview } from '@/lib/server/contextual-assignment-overview-read'
import type { Database } from '@/types/database'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const assignmentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const stamp = '2026-10-01T12:00:00Z'
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const classroom = { id: classroomId, teacher_id: actorId, archived_at: null }
const assignment = { id: assignmentId, classroom_id: classroomId, title: 'Essay', description: '', due_at: stamp, position: 0,
  created_by: actorId, created_at: stamp, updated_at: stamp, is_draft: false, released_at: null, instructions_markdown: 'Write', rich_instructions: null,
  artifact_id: uuid(99999), source_artifact_id: null, source_blueprint_version_id: null, blueprint_archived_at: null, points_possible: 30,
  gradebook_category_id: null, gradebook_maximum_override: null, gradebook_score_scale: 1, gradebook_weight: 1, include_in_final: true, track_authenticity: true }
const requirement = (n: number, type = 'link') => ({ id: uuid(n + 30000), assignment_id: assignmentId, artifact_id: uuid(n + 40000), type, label: 'Evidence', instructions: '',
  required: true, position: n, created_at: stamp, updated_at: stamp, source_artifact_id: null, source_blueprint_version_id: null, validation_policy_json: {} })
const doc = (n: number) => ({ id: uuid(n + 50000), assignment_id: assignmentId, student_id: uuid(n + 20000),
  participant: { id: uuid(n + 20000), enrollment: [{ classroom_id: classroomId, student_id: uuid(n + 20000) }] }, content: { type: 'doc', content: [] },
  is_submitted: true, submitted_at: stamp, updated_at: stamp, score_completion: 0, score_thinking: null, score_workflow: null,
  graded_at: stamp, returned_at: stamp, teacher_cleared_at: null, feedback_returned_at: null })
const artifact = (n: number, parent = doc(0), type = 'link') => ({ id: uuid(n + 60000), assignment_doc_id: parent.id, student_id: parent.student_id,
  requirement_id: uuid(n + 30000), type, url: `https://example.test/${n}`, storage_path: null, managed_object_id: null, managed_object: null,
  metadata_json: {}, validation_status: 'valid', validation_message: null, validated_at: stamp, created_at: stamp, updated_at: stamp,
  requirement: { id: uuid(n + 30000), assignment_id: assignmentId, type } })
const run = { id: uuid(90000), assignment_id: assignmentId, status: 'running', model: 'test', requested_count: 1001, gradable_count: 1001, processed_count: 0,
  completed_count: 0, skipped_missing_count: 0, skipped_empty_count: 0, failed_count: 0, error_samples_json: [], started_at: stamp, completed_at: null, created_at: stamp }

function fixture(options: { count?: number; docs?: any[]; requirements?: any[]; artifacts?: any[]; history?: any[]; run?: any; items?: any[];
  intercept?: (row: any, url: URL, index: number) => unknown; sign?: (paths: string[]) => unknown } = {}) {
  const urls: URL[] = []
  const bodies: any[] = []
  const enrollments = Array.from({ length: options.count ?? 1 }, (_, n) => ({ id: uuid(n + 10000), classroom_id: classroomId, student_id: uuid(n + 20000),
    users: { id: uuid(n + 20000), email: `s${n}@example.test`, profiles: null } }))
  const fetcher = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(request)); urls.push(url)
    if (url.pathname.includes('/storage/v1/')) {
      const body = JSON.parse(String(init?.body)); bodies.push(body)
      return new Response(JSON.stringify(options.sign ? options.sign(body.paths) : body.paths.map((path: string) => ({ path, error: null, signedURL: `/object/sign/assignment-artifacts/${path}?token=fake` }))), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const select = url.searchParams.get('select') ?? ''
    const after = (key: string) => url.searchParams.getAll(key).find(v => v.startsWith('gt.'))?.slice(3) ?? ''
    let row: any = { id: assignmentId, classroom_id: classroomId, classrooms: classroom }
    if (select.includes('title,description')) row = { ...assignment, classrooms: { ...classroom, title: 'Class' } }
    else if (select.includes('enrollments:')) row.classrooms = { ...classroom, enrollments: enrollments.filter(e => e.id > after('classrooms.enrollments.id')).slice(0, 1000) }
    else if (select.includes('requirements:')) row.requirements = (options.requirements ?? []).filter(r => r.id > after('requirements.id')).slice(0, 1000)
    else if (select.includes('docs:')) {
      const parents = options.docs ?? []
      if (select.includes('artifacts:') || select.includes('history:')) {
        const kind = select.includes('artifacts:') ? 'artifacts' : 'history'
        const ids = (url.searchParams.get('docs.id') ?? '').slice(4, -1).split(',')
        const scoped = url.searchParams.get('docs.artifacts.id')
        const scopedIds = scoped?.startsWith('in.') ? scoped.slice(4, -1).split(',') : undefined
        row.docs = parents.filter(d => ids.includes(d.id)).map(d => ({ id: d.id, assignment_id: d.assignment_id, student_id: d.student_id, participant: d.participant,
          [kind]: (options[kind] ?? []).filter(c => c.assignment_doc_id === d.id && c.id > after(`docs.${kind}.id`) && (!scopedIds || scopedIds.includes(c.id)))
            .slice(0, Number(url.searchParams.get(`docs.${kind}.limit`))) }))
      } else row.docs = parents.filter(d => d.id > after('docs.id')).slice(0, 1000)
    } else if (select.includes('runs:')) row.runs = options.run ? [select.includes('items:') ? { id: options.run.id, assignment_id: options.run.assignment_id, status: options.run.status,
      items: (options.items ?? []).filter(i => i.id > after('runs.items.id')).slice(0, 1000) } : options.run] : []
    if (options.intercept) row = options.intercept(row, url, urls.length - 1)
    return new Response(JSON.stringify(row), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  const supabase = createClient<Database>('http://127.0.0.1:54321', 'fake-key', { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } })
  return { urls, bodies, fetcher, supabase, read: () => readContextualAssignmentOverview({ supabase, actorId, assignmentId }) }
}

describe('statement-bound assignment overview with installed SDK', () => {
  it('binds every payload and terminal to the requested assignment, current classroom and owner', async () => {
    const f = fixture(); const result = await f.read()
    expect(result).toMatchObject({ assignment: { id: assignmentId, instructions_markdown: 'Write' }, classroom: { title: 'Class' }, students: [{ student_email: 's0@example.test', doc: null }], active_ai_grading_run: null })
    for (const url of f.urls.slice(1)) {
      expect(url.pathname).toBe('/rest/v1/assignments')
      expect(url.searchParams.get('id')).toBe(`eq.${assignmentId}`)
      expect(url.searchParams.get('classroom_id')).toBe(`eq.${classroomId}`)
      expect(url.searchParams.get('classrooms.teacher_id')).toBe(`eq.${actorId}`)
      expect(url.searchParams.get('select')).toContain('classrooms!assignments_classroom_id_fkey!inner')
      expect(url.searchParams.get('select')).not.toMatch(/\*|lease_token|gradex_|ai_feedback|authenticity_score|authenticity_flags/)
    }
  })
  it('reads more than one PostgREST page of roster members', async () => {
    const f = fixture({ count: 1001 }); expect((await f.read()).students).toHaveLength(1001)
    expect(f.urls.filter(u => u.searchParams.get('select')?.includes('enrollments:'))).toHaveLength(3)
  })
  it.each([1, 2, 3, 4, 5, 6])('rejects current-owner revocation at payload/terminal statement %s', async index => {
    await expect(fixture({ intercept: (row, _url, n) => n === index ? null : row }).read()).rejects.toMatchObject({ statusCode: 403 })
  })
  it.each([{ id: uuid(1) }, { classroom_id: uuid(2) }, { classrooms: { ...classroom, teacher_id: uuid(3) } }, { private_column: 'secret' }])('rejects substituted or widened root %#', async patch => {
    await expect(fixture({ intercept: (row, _url, n) => n === 1 ? { ...row, ...patch } : row }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('fails uncertain transport without retries', async () => {
    const f = fixture(); f.fetcher.mockRejectedValue(new Error('private backend error'))
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 }); expect(f.fetcher).toHaveBeenCalledTimes(1)
  })
  it('aborts an unresponsive transport at 20 seconds', async () => {
    vi.useFakeTimers()
    try { const f = fixture(); f.fetcher.mockImplementation(() => new Promise<Response>(() => {}))
      const result = expect(f.read()).rejects.toMatchObject({ statusCode: 503 }); await vi.advanceTimersByTimeAsync(20000); await result
    } finally { vi.useRealTimers() }
  })
  it('paginates >1000 docs, requirements, histories, artifacts and run items', async () => {
    const docs = Array.from({ length: 1001 }, (_, n) => doc(n))
    const requirements = Array.from({ length: 1001 }, (_, n) => requirement(n))
    const artifacts = Array.from({ length: 1001 }, (_, n) => artifact(n))
    const history = Array.from({ length: 1001 }, (_, n) => ({ id: uuid(n + 70000), assignment_doc_id: docs[0].id, created_at: stamp }))
    const items = Array.from({ length: 1001 }, (_, n) => ({ id: uuid(n + 80000), assignment_id: assignmentId, run_id: run.id, student_id: uuid(n + 20000), status: 'queued', next_retry_at: '2099-01-01T12:00:00Z' }))
    const f = fixture({ count: 1001, docs, requirements, artifacts, history, run, items }); const result = await f.read()
    expect(result.students).toHaveLength(1001); expect(result.assignment.submission_requirements).toHaveLength(1001)
    expect(result.students.find(s => s.student_id === docs[0].student_id)).toMatchObject({ student_updated_at: stamp, submission_artifacts: expect.any(Array), doc: { score_completion: 0 } })
    expect(result.students.find(s => s.student_id === docs[0].student_id)?.submission_artifacts).toHaveLength(1001)
    expect(result.active_ai_grading_run).toMatchObject({ id: run.id, next_retry_at: '2099-01-01T12:00:00.000Z' })
    for (const url of f.urls.filter(u => u.searchParams.get('select')?.includes('docs:'))) {
      expect(url.searchParams.get('docs.participant.enrollment.classroom_id')).toBe(`eq.${classroomId}`)
      expect(url.searchParams.get('docs.student_id')).toBe(`neq.${actorId}`)
      if (url.searchParams.get('select')?.includes('artifacts:')) expect(url.searchParams.get('docs.artifacts.requirement.assignment_id')).toBe(`eq.${assignmentId}`)
    }
  })
  it('retains every nested sibling when child tails differ', async () => {
    const docs = [doc(0), doc(1)]; const history = Array.from({ length: 201 }, (_, n) => ({ id: uuid(n + 70000), assignment_doc_id: n % 2 ? docs[0].id : docs[1].id, created_at: stamp }))
    const f = fixture({ count: 2, docs, history }); const result = await f.read()
    expect(result.students.every(s => s.student_updated_at === stamp)).toBe(true)
    const pages = f.urls.filter(u => u.searchParams.get('select')?.includes('history:'))
    expect(pages).toHaveLength(4)
    expect(pages[1].searchParams.get('docs.history.id')).toBe(`gt.${uuid(70198)}`)
  })
  it.each(['roster', 'doc', 'parent', 'requirement', 'history', 'artifact', 'run', 'item'])('rejects exact identity substitutions for %s', async kind => {
    const d = doc(0); const a = artifact(0)
    const f = fixture({ docs: [d], requirements: [requirement(0)], artifacts: [a], history: [{ id: uuid(70000), assignment_doc_id: d.id, created_at: stamp }], run,
      items: [{ id: uuid(80000), run_id: run.id, assignment_id: assignmentId, student_id: d.student_id, status: 'queued', next_retry_at: null }],
      intercept: (row, url) => {
        const select = url.searchParams.get('select') ?? ''
        if (kind === 'roster' && row.classrooms.enrollments?.length) row.classrooms.enrollments[0].users.id = actorId
        if (kind === 'doc' && row.docs?.length) row.docs[0].participant.enrollment[0].classroom_id = uuid(5)
        if (kind === 'parent' && select.includes('artifacts:')) row.docs = []
        if (kind === 'requirement' && row.requirements?.length) row.requirements[0].assignment_id = uuid(5)
        if (kind === 'history' && row.docs?.[0]?.history?.length) row.docs[0].history[0].assignment_doc_id = uuid(5)
        if (kind === 'artifact' && row.docs?.[0]?.artifacts?.length) row.docs[0].artifacts[0].student_id = actorId
        if (kind === 'run' && row.runs?.length) row.runs[0].assignment_id = uuid(5)
        if (kind === 'item' && row.runs?.[0]?.items?.length) row.runs[0].items[0].run_id = uuid(5)
        return row
      } })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('uses the real Storage SDK batch response after a fresh bound proof before signing', async () => {
    const d = doc(0); const a = { ...artifact(0, d, 'image'), storage_path: `${d.student_id}/${assignmentId}/${uuid(30000)}-123-${uuid(999)}.png` }
    const f = fixture({ docs: [d], requirements: [requirement(0, 'image')], artifacts: [a] }); const result = await f.read()
    expect(f.bodies).toEqual([{ expiresIn: 3600, paths: [a.storage_path] }])
    expect(result.students[0].submission_artifacts[0].url).toContain(`http://127.0.0.1:54321/storage/v1/object/sign/assignment-artifacts/${a.storage_path}`)
    const signingIndex = f.urls.findIndex(u => u.pathname.includes('/storage/v1/'))
    expect(f.urls[signingIndex - 1].searchParams.get('docs.artifacts.id')).toBe(`in.(${a.id})`)
    const denied = fixture({ docs: [d], requirements: [requirement(0, 'image')], artifacts: [a], intercept: (row, url) => url.searchParams.has('docs.artifacts.id') ? null : row })
    await expect(denied.read()).rejects.toMatchObject({ statusCode: 403 }); expect(denied.bodies).toHaveLength(0)
  })
  it('keeps archived owner access and denies missing/foreign control before payload queries', async () => {
    await expect(fixture({ intercept: row => ({ ...row, classrooms: { ...row.classrooms, archived_at: stamp } }) }).read()).resolves.toHaveProperty('students')
    for (const [control, status] of [[null, 404], [{ id: assignmentId, classroom_id: classroomId, classrooms: { ...classroom, teacher_id: uuid(5) } }, 403]] as const) {
      const f = fixture({ intercept: (row, _url, n) => n === 0 ? control : row })
      await expect(f.read()).rejects.toMatchObject({ statusCode: status }); expect(f.fetcher).toHaveBeenCalledTimes(1)
    }
  })
  it.each([null, {}, { private: 'secret' }])('rejects incomplete/uncertain persisted collections %#', async children => {
    await expect(fixture({ intercept: (row, url) => url.searchParams.get('select')?.includes('requirements:') ? { ...row, requirements: children } : row }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each(['same', 'backward', 'stalled'])('rejects %s cursors rather than return an incomplete roster', async mode => {
    const f = fixture({ count: 2, intercept: (row, url) => {
      const children = row.classrooms?.enrollments
      if (children?.length && mode === 'same') children[1].id = children[0].id
      if (children?.length && mode === 'backward') children.reverse()
      if (mode === 'stalled' && url.searchParams.has('classrooms.enrollments.id')) row.classrooms.enrollments = [{ id: uuid(10000), classroom_id: classroomId, student_id: uuid(20000), users: { id: uuid(20000), email: 'a@example.test', profiles: null } }]
      return row
    } })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('rejects owner self-enrollment, nonunique profiles and wrong profile binding', async () => {
    for (const patch of [{ student_id: actorId }, { users: { id: uuid(20000), email: 'a@example.test', profiles: [] } },
      { users: { id: uuid(20000), email: 'a@example.test', profiles: { user_id: actorId, first_name: 'A', last_name: null } } }]) {
      await expect(fixture({ intercept: row => {
        if (row.classrooms?.enrollments?.length) Object.assign(row.classrooms.enrollments[0], patch)
        return row
      } }).read()).rejects.toMatchObject({ statusCode: 503 })
    }
  })
  it.each(['roster', 'requirements'])('enforces the 10000-row total cap for %s', async kind => {
    const f = fixture(kind === 'roster' ? { count: 10001 } : { requirements: Array.from({ length: 10001 }, (_, n) => requirement(n)) })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('rejects statement JSON byte/depth overflow and invalid identity before any payload', async () => {
    for (const patch of [{ description: 'x'.repeat(8 * 1024 * 1024) }, { rich_instructions: Array.from({ length: 102 }, () => 1).reduce<any>(value => ({ type: 'doc', content: [value] }), { type: 'paragraph' }) }]) {
      await expect(fixture({ intercept: (row, _url, n) => n === 1 ? { ...row, ...patch } : row }).read()).rejects.toMatchObject({ statusCode: 503 })
    }
    const f = fixture(); await expect(readContextualAssignmentOverview({ supabase: f.supabase, actorId: 'bad', assignmentId })).rejects.toMatchObject({ statusCode: 400 })
    expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('rejects terminal membership removal at nested artifact/history/run item pages', async () => {
    const d = doc(0)
    for (const kind of ['artifacts', 'history', 'items']) {
      const f = fixture({ docs: [d], requirements: [requirement(0)], artifacts: [artifact(0)], history: [{ id: uuid(70000), assignment_doc_id: d.id, created_at: stamp }], run,
        items: [{ id: uuid(80000), run_id: run.id, assignment_id: assignmentId, student_id: d.student_id, status: 'queued', next_retry_at: null }], intercept: (row, url) => {
          if (url.searchParams.has(`docs.${kind}.id`)) row.docs = []
          if (url.searchParams.has(`runs.${kind}.id`)) row.runs = []
          return row
        } })
      await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
    }
  })
  it.each(['wrong-path', 'wrong-requirement', 'wrong-member', 'duplicate-child', 'private-field'])('rejects %s artifact before signing', async kind => {
    const d = doc(0); const a = { ...artifact(0, d, 'image'), storage_path: `${d.student_id}/${assignmentId}/${uuid(30000)}-123-${uuid(999)}.png` }
    const f = fixture({ docs: [d], requirements: [requirement(0, 'image')], artifacts: [a], intercept: (row, url) => {
      if (url.searchParams.get('select')?.includes('artifacts:') && row.docs?.[0]?.artifacts?.length) {
        const child = row.docs[0].artifacts[0]
        if (kind === 'wrong-path') child.storage_path = `foreign/${a.storage_path}`
        if (kind === 'wrong-requirement') child.requirement.assignment_id = uuid(5)
        if (kind === 'wrong-member') row.docs[0].participant.enrollment[0].student_id = actorId
        if (kind === 'duplicate-child') row.docs[0].artifacts.push({ ...child })
        if (kind === 'private-field') child.lease_token = 'secret'
      }
      return row
    } })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 }); expect(f.bodies).toHaveLength(0)
  })
  it('verifies managed ownership inside the artifact statement and strips control evidence from output', async () => {
    const d = doc(0); const objectId = uuid(999)
    const storagePath = `classrooms/${classroomId}/students/${d.student_id}/assignment-docs/${d.id}/artifacts/${objectId}.png`
    const a = { ...artifact(0, d, 'image'), storage_path: storagePath, managed_object_id: objectId, managed_object: { id: objectId, classroom_id: classroomId,
      data_subject_user_id: d.student_id, resource_type: 'assignment_doc', resource_id: d.id, purpose: 'student_assignment_artifact', status: 'ready', storage_bucket: 'assignment-artifacts', storage_path: storagePath } }
    const result = await fixture({ docs: [d], requirements: [requirement(0, 'image')], artifacts: [a] }).read()
    expect(result.students[0].submission_artifacts[0]).not.toHaveProperty('managed_object')
    for (const patch of [{ resource_id: uuid(5) }, { data_subject_user_id: actorId }, { classroom_id: uuid(5) }, { id: uuid(5) }, { storage_path: 'foreign' }, { status: 'cleanup_processing' }]) {
      const f = fixture({ docs: [d], requirements: [requirement(0, 'image')], artifacts: [{ ...a, managed_object: { ...a.managed_object, ...patch } }] })
      await expect(f.read()).rejects.toMatchObject({ statusCode: 503 }); expect(f.bodies).toHaveLength(0)
    }
  })
  it('rejects unexpected signing identities/paths and tolerates closed per-path signing errors', async () => {
    const d = doc(0); const a = { ...artifact(0, d, 'image'), storage_path: `${d.student_id}/${assignmentId}/${uuid(30000)}-123-${uuid(999)}.png` }
    for (const response of [[{ path: 'foreign', error: null, signedURL: '/object/sign/foreign?token=x' }],
      [{ path: a.storage_path, error: null, signedURL: '/object/sign/assignment-artifacts/foreign?token=x' }],
      [{ path: a.storage_path, error: null, signedURL: `/object/sign/assignment-artifacts/${a.storage_path}?token=x&other=1` }],
      [{ path: a.storage_path, error: null, signedURL: `/object/sign/assignment-artifacts/${a.storage_path}?token=x`, secret: 'private' }], []]) {
      await expect(fixture({ docs: [d], requirements: [requirement(0, 'image')], artifacts: [a], sign: () => response }).read()).rejects.toMatchObject({ statusCode: 503 })
    }
    const f = fixture({ docs: [d], requirements: [requirement(0, 'image')], artifacts: [a], sign: paths => paths.map(path => ({ path, error: 'not found', signedURL: null })) })
    expect((await f.read()).students[0].submission_artifacts[0].url).toBe(a.url)
  })
})
