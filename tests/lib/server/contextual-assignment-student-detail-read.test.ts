import { describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { readContextualAssignmentStudentDetail } from '@/lib/server/contextual-assignment-student-detail-read'
import type { Database } from '@/types/database'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const assignmentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const studentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const stamp = '2026-10-01T12:00:00Z'
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const classroom = { id: classroomId, teacher_id: actorId, archived_at: null }
const enrollment = { id: uuid(1), classroom_id: classroomId, student_id: studentId }
const assignment = { id: assignmentId, classroom_id: classroomId, title: 'Essay', description: '', due_at: stamp, position: 0,
  created_by: actorId, created_at: stamp, updated_at: stamp, instructions_markdown: 'Write', rich_instructions: null }
const requirement = (n: number, type = 'link') => ({ id: uuid(30000 + n), assignment_id: assignmentId, artifact_id: uuid(40000 + n), type, label: 'Evidence', instructions: '', required: true,
  position: n, created_at: stamp, updated_at: stamp, source_artifact_id: null, source_blueprint_version_id: null, validation_policy_json: {} })
const doc = { id: uuid(50000), assignment_id: assignmentId, student_id: studentId, content: JSON.stringify({ type: 'doc', content: [] }), content_legacy: 'legacy',
  is_submitted: true, submitted_at: stamp, created_at: stamp, updated_at: stamp, viewed_at: stamp, save_sequence: 3, save_session_id: uuid(9), repo_url: 'https://github.com/legacy/repo', github_username: 'legacy',
  score_completion: 0, score_thinking: 1, score_workflow: 2, feedback: 'returned', teacher_feedback_draft: 'private teacher draft', teacher_feedback_draft_updated_at: stamp,
  feedback_returned_at: stamp, ai_feedback_suggestion: 'private AI draft', ai_feedback_suggested_at: stamp, ai_feedback_model: 'model', ai_grading_provenance: { private: 'provenance' },
  ai_grading_review: { private: 'review' }, teacher_cleared_at: null, graded_at: stamp, graded_by: actorId, returned_at: stamp, authenticity_score: 70, authenticity_flags: [{ private: 'flag' }] }
const feedback = (n: number) => ({ id: uuid(60000 + n), assignment_id: assignmentId, student_id: studentId, author_type: 'teacher', entry_kind: 'teacher_feedback', body: `Feedback ${n}`,
  created_at: stamp, returned_at: stamp, created_by: actorId })
const target = { id: uuid(70000), assignment_id: assignmentId, student_id: studentId, selected_repo_url: 'https://github.com/override/repo', override_github_username: 'override',
  repo_owner: 'override', repo_name: 'repo', selection_mode: 'teacher_override', validation_status: 'valid', validation_message: null, validated_at: stamp, created_at: stamp, updated_at: stamp }
const review = { id: uuid(80000), run_id: uuid(81000), assignment_id: assignmentId, student_id: studentId, github_login: 'student', commit_count: 3, active_days: 1, session_count: 1, burst_ratio: 0,
  weighted_contribution: 2, relative_contribution_share: 1, spread_score: 2, iteration_score: 3, semantic_breakdown_json: {}, timeline_json: [], evidence_json: [], draft_score_completion: 1,
  draft_score_thinking: 2, draft_score_workflow: 3, draft_feedback: 'private repository draft', confidence: 1, created_at: stamp, grading_model: 'private model', grading_provenance: { private: 'repo provenance' },
  run: { id: uuid(81000), assignment_id: assignmentId, status: 'completed' } }
const artifact = (n: number, type = 'link') => ({ id: uuid(90000 + n), assignment_doc_id: doc.id, requirement_id: uuid(30000 + n), student_id: studentId, type,
  url: `https://example.test/${n}`, storage_path: null, managed_object_id: null, metadata_json: {}, validation_status: 'valid', validation_message: null, validated_at: stamp, created_at: stamp, updated_at: stamp,
  requirement: { id: uuid(30000 + n), assignment_id: assignmentId, type }, managed_object: null })

function fixture(options: { doc?: any; profiles?: any[]; targets?: any[]; reviews?: any[]; feedback?: any[]; requirements?: any[]; artifacts?: any[]; cap?: number;
  intercept?: (row: any, url: URL, index: number) => unknown; sign?: (paths: string[]) => unknown; storageFailure?: 'network' | 'api' | 'invalidJson' } = {}) {
  const urls: URL[] = []; const bodies: any[] = []
  const fetcher = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(request)); urls.push(url)
    if (url.pathname.includes('/storage/v1/')) {
      const body = JSON.parse(String(init?.body)); bodies.push(body)
      if (options.storageFailure === 'network') throw new Error('Private network failure')
      if (options.storageFailure === 'api') return new Response(JSON.stringify({ message: 'Unavailable' }), { status: 503, headers: { 'content-type': 'application/json' } })
      if (options.storageFailure === 'invalidJson') return new Response('{bad', { status: 200, headers: { 'content-type': 'application/json' } })
      return new Response(JSON.stringify(options.sign ? options.sign(body.paths) : body.paths.map((path: string) => ({ path, error: null, signedURL: `/object/sign/assignment-artifacts/${path}?token=fake` }))), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const select = url.searchParams.get('select') ?? ''
    const page = (kind: string, rows: any[]) => {
      const cursor = url.searchParams.get(`${kind}.id`)?.slice(3) ?? ''
      const allowed = url.searchParams.get(`${kind}.id`)?.startsWith('in.') ? url.searchParams.get(`${kind}.id`)!.slice(4, -1).split(',') : null
      return rows.filter(r => allowed ? allowed.includes(r.id) : r.id > cursor).slice(0, Math.min(options.cap ?? Infinity, Number(url.searchParams.get(`${kind}.limit`) ?? 1000)))
    }
    let row: any = { id: assignmentId, classroom_id: classroomId, classrooms: { ...classroom } }
    if (select.includes('target:')) row.classrooms.target = [{ ...enrollment }]
    if (select.includes('users!')) row.classrooms.target[0].users = { id: studentId, email: 'student@example.test', profiles: options.profiles ? options.profiles.length > 1 ? options.profiles : options.profiles[0] ?? null : { user_id: studentId, first_name: 'First', last_name: 'Last' } }
    if (select.includes('instructions_markdown')) row = { ...row, ...assignment, classrooms: { ...row.classrooms, title: 'Class' } }
    if (select.includes('requirements:')) row.requirements = page('requirements', options.requirements ?? [])
    if (select.includes('feedback:')) row.feedback = page('feedback', options.feedback ?? [])
    if (select.includes('targets:')) row.targets = options.targets ?? []
    if (select.includes('reviews:')) row.reviews = (options.reviews ?? []).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)).slice(0, 1)
    if (select.includes('docs:')) {
      const d = Object.hasOwn(options, 'doc') ? options.doc : null
      row.docs = d ? [select.includes('artifacts:') ? { id: d.id, assignment_id: d.assignment_id, student_id: d.student_id, artifacts: page('docs.artifacts', options.artifacts ?? []) } : { ...d }] : []
    }
    if (options.intercept) row = options.intercept(structuredClone(row), url, urls.length - 1)
    return new Response(JSON.stringify(row), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  const supabase = createClient<Database>('http://127.0.0.1:54321', 'fake-key', { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } })
  const read = (overrides = {}) => readContextualAssignmentStudentDetail({ supabase, actorId, assignmentId, studentId, ...overrides })
  return { urls, bodies, fetcher, supabase, read }
}

describe('exact student detail with installed SDK', () => {
  it('binds every payload, supplement, empty terminal and final statement to owner and exact enrollment', async () => {
    const f = fixture(); const result = await f.read()
    expect(result).toMatchObject({ assignment: { id: assignmentId, instructions_markdown: 'Write' }, classroom: { title: 'Class' }, student: { id: studentId, email: 'student@example.test', name: 'First Last' }, doc: null })
    for (const url of f.urls.slice(2)) {
      expect(url.pathname).toBe('/rest/v1/assignments'); expect(url.searchParams.get('id')).toBe(`eq.${assignmentId}`)
      expect(url.searchParams.get('classroom_id')).toBe(`eq.${classroomId}`); expect(url.searchParams.get('classrooms.teacher_id')).toBe(`eq.${actorId}`)
      expect(url.searchParams.get('classrooms.target.student_id')).toBe(`eq.${studentId}`); expect(url.searchParams.get('classrooms.target.classroom_id')).toBe(`eq.${classroomId}`)
      expect(url.searchParams.get('select')).toContain('classroom_enrollments!classroom_enrollments_classroom_id_fkey!inner')
      expect(url.searchParams.get('select')).not.toMatch(/\*|password|student_number|lease_token|user_github_identities|requested_by|execution_token/)
    }
  })
  it('preserves all document, feedback, target and review fields with joined control removed', async () => {
    const f = fixture({ doc, feedback: [feedback(0)], targets: [target], reviews: [review], requirements: [requirement(0)], artifacts: [artifact(0)] })
    const result = await f.read()
    expect(result.doc).toEqual({ ...doc, content: { type: 'doc', content: [] } })
    expect(result.feedback_entries).toEqual([feedback(0)]); expect(result.repo_target.target).toEqual(target)
    const { run: _run, ...plainReview } = review
    expect(result.repo_target.latest_result).toEqual(plainReview); expect(result.submission_artifacts[0]).not.toHaveProperty('requirement')
    const reviewUrl = f.urls.find(u => u.searchParams.has('reviews.run.status'))!
    expect(reviewUrl.searchParams.get('reviews.run.status')).toBe('eq.completed'); expect(reviewUrl.searchParams.get('reviews.run.assignment_id')).toBe(`eq.${assignmentId}`)
    expect(reviewUrl.searchParams.get('reviews.order')).toBe('created_at.desc,id.desc')
  })
  it.each([null, { ...classroom, teacher_id: uuid(2) }])('rejects genuine missing/nonowner preflight before payload', async control => {
    const f = fixture({ intercept: (row, _url, i) => i === 0 ? control === null ? null : { ...row, classrooms: control } : row })
    await expect(f.read()).rejects.toMatchObject({ statusCode: control ? 403 : 404 }); expect(f.urls).toHaveLength(1)
  })
  it('keeps archived owner read access', async () => {
    await expect(fixture({ intercept: row => ({ ...row, classrooms: { ...row.classrooms, archived_at: stamp } }) }).read()).resolves.toHaveProperty('student')
  })
  it('denies owner self-target even with historical enrollment', async () => {
    const f = fixture(); await expect(f.read({ studentId: actorId })).rejects.toMatchObject({ statusCode: 403 }); expect(f.urls).toHaveLength(1)
  })
  it('returns404 for genuinely absent exact target and rejects duplicate control', async () => {
    for (const [targets, code] of [[[], 404], [[enrollment, enrollment], 503]] as const) {
      const f = fixture({ intercept: (row, _url, i) => i === 1 ? { ...row, classrooms: { ...row.classrooms, target: targets } } : row })
      await expect(f.read()).rejects.toMatchObject({ statusCode: code }); expect(f.urls).toHaveLength(2)
    }
  })
  it.each([2, 3, 4, 5, 6, 7, 8])('rejects owner/enrollment loss at payload/terminal/final statement %s', async index => {
    const f = fixture({ intercept: (row, _url, i) => i === index ? null : row })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('reads >1000 feedback, requirements and artifacts and always performs empty terminal reads', async () => {
    const f = fixture({ doc, feedback: Array.from({ length: 1001 }, (_, n) => feedback(n)), requirements: Array.from({ length: 1001 }, (_, n) => requirement(n)), artifacts: Array.from({ length: 1001 }, (_, n) => artifact(n)) })
    const result = await f.read(); expect(result.feedback_entries).toHaveLength(1001); expect(result.assignment.submission_requirements).toHaveLength(1001); expect(result.submission_artifacts).toHaveLength(1001)
    for (const kind of ['requirements', 'feedback', 'docs.artifacts']) expect(f.urls.filter(u => u.searchParams.has(`${kind}.order`))).toHaveLength(3)
  })
  it('continues shortened pages and sorts feedback and requirements deterministically', async () => {
    const fs = [feedback(0), { ...feedback(1), returned_at: '2026-09-01T12:00:00Z' }, feedback(2)]
    const rs = [requirement(0), { ...requirement(1), position: -1 }, requirement(2)]
    const f = fixture({ feedback: fs, requirements: rs, cap: 1 }); const result = await f.read()
    expect(result.feedback_entries.map(r => r.id)).toEqual([fs[1].id, fs[0].id, fs[2].id]); expect(result.assignment.submission_requirements.map(r => r.id)).toEqual([rs[1].id, rs[0].id, rs[2].id])
    expect(f.urls.filter(u => u.searchParams.has('requirements.order'))).toHaveLength(4)
  })
  it.each(['docs', 'profiles', 'targets'])('rejects duplicate optional singleton %s rather than masking with limit1', async kind => {
    const f = fixture({ doc, targets: [target], intercept: (row, url) => {
      if (kind === 'docs' && row.docs?.length && !url.searchParams.get('select')?.includes('artifacts:')) row.docs.push(row.docs[0])
      if (kind === 'profiles' && row.classrooms.target?.[0]?.users) row.classrooms.target[0].users.profiles = [row.classrooms.target[0].users.profiles, row.classrooms.target[0].users.profiles]
      if (kind === 'targets' && row.targets?.length) row.targets.push(row.targets[0])
      return row
    } }); await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('retains optional nulls and current concatenation of nullable names', async () => {
    expect((await fixture({ profiles: [] }).read()).student.name).toBe(null)
    expect((await fixture({ profiles: [{ user_id: studentId, first_name: null, last_name: 'Last' }] }).read()).student.name).toBe('null Last')
  })
  it('requires a fresh exact artifact proof before signing with the real SDK response', async () => {
    const a = { ...artifact(0, 'image'), storage_path: `${studentId}/${assignmentId}/${requirement(0).id}-123-${uuid(99)}.png` }
    const f = fixture({ doc, requirements: [requirement(0, 'image')], artifacts: [a] }); const result = await f.read()
    expect(f.bodies).toEqual([{ paths: [a.storage_path], expiresIn: 3600 }]); expect(result.submission_artifacts[0].url).toContain('?token=fake')
    const index = f.urls.findIndex(u => u.pathname.includes('/storage/')); expect(f.urls[index - 1].searchParams.get('docs.artifacts.id')).toBe(`in.(${a.id})`)
    const denied = fixture({ doc, requirements: [requirement(0, 'image')], artifacts: [a], intercept: (row, url) => url.searchParams.get('docs.artifacts.id')?.startsWith('in.') ? null : row })
    await expect(denied.read()).rejects.toMatchObject({ statusCode: 503 }); expect(denied.bodies).toHaveLength(0)
  })
  it('fails transport uncertainty and stalled transport within20seconds', async () => {
    const f = fixture(); f.fetcher.mockRejectedValue(new Error('private failure')); await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
    vi.useFakeTimers()
    try { const slow = fixture(); slow.fetcher.mockImplementation(() => new Promise<Response>(() => {}))
      const result = expect(slow.read()).rejects.toMatchObject({ statusCode: 503 }); await vi.advanceTimersByTimeAsync(20000); await result
    } finally { vi.useRealTimers() }
  })
  it.each([studentId, uuid(991)])('denies member/outsider actor %s before any payload', async actor => {
    const f = fixture(); await expect(f.read({ actorId: actor })).rejects.toMatchObject({ statusCode: 403 }); expect(f.urls).toHaveLength(1)
  })
  it.each(['root', 'owner', 'enrollment', 'profile', 'user', 'doc', 'feedback', 'target', 'requirement', 'review', 'run'])('rejects exact identity substitution for %s', async kind => {
    const f = fixture({ doc, feedback: [feedback(0)], targets: [target], reviews: [review], requirements: [requirement(0)], intercept: (row, url, index) => {
      if (index < 2) return row
      if (kind === 'root') row.id = uuid(4)
      if (kind === 'owner') row.classrooms.teacher_id = uuid(4)
      if (kind === 'enrollment') row.classrooms.target[0].student_id = uuid(4)
      if (kind === 'user' && row.classrooms.target[0].users) row.classrooms.target[0].users.id = uuid(4)
      if (kind === 'profile' && row.classrooms.target[0].users) row.classrooms.target[0].users.profiles.user_id = uuid(4)
      if (kind === 'doc' && row.docs?.length) row.docs[0].student_id = uuid(4)
      if (kind === 'feedback' && row.feedback?.length) row.feedback[0].assignment_id = uuid(4)
      if (kind === 'target' && row.targets?.length) row.targets[0].student_id = uuid(4)
      if (kind === 'requirement' && row.requirements?.length) row.requirements[0].assignment_id = uuid(4)
      if (kind === 'review' && row.reviews?.length) row.reviews[0].student_id = uuid(4)
      if (kind === 'run' && row.reviews?.length) row.reviews[0].run.id = uuid(4)
      return row
    } }); await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('selects the latest completed review with deterministic tie-breaking and strips its run control', async () => {
    const newer = { ...review, id: uuid(80001) }; const result = await fixture({ reviews: [review, newer] }).read()
    expect(result.repo_target.latest_result?.id).toBe(newer.id); expect(result.repo_target.latest_result).not.toHaveProperty('run')
  })
  it('preserves structured repository > content > legacy choice and teacher override', async () => {
    const a = { ...artifact(0, 'repo_link'), url: 'https://github.com/structured/repo', metadata_json: { github_username: 'structured' } }
    const f = fixture({ doc, artifacts: [a], requirements: [requirement(0, 'repo_link')], targets: [target] }); const result = await f.read()
    expect(result.repo_target.submittedRepoUrl).toBe(a.url); expect(result.repo_target.effectiveRepoUrl).toBe(target.selected_repo_url)
    expect(result.repo_target.selectionMode).toBe('teacher_override')
    const legacy = await fixture({ doc }).read(); expect(legacy.repo_target.submittedRepoUrl).toBe(doc.repo_url)
  })
  it.each(['missing', 'duplicate', 'stall', 'widened'])('rejects malformed/duplicate/stalled/widened collection evidence: %s', async kind => {
    const f = fixture({ feedback: [feedback(0)], intercept: (row, url) => {
      if (!url.searchParams.has('feedback.order')) return row
      if (kind === 'missing') delete row.feedback
      if (kind === 'duplicate') row.feedback = [feedback(0), feedback(0)]
      if (kind === 'stall') row.feedback = [feedback(0)]
      if (kind === 'widened') row.private_data = 'unselected'
      return row
    } }); await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('rejects lost exact document parent even on an empty artifact terminal', async () => {
    const f = fixture({ doc, intercept: (row, url) => url.searchParams.has('docs.artifacts.order') ? { ...row, docs: [] } : row })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 }); expect(f.bodies).toHaveLength(0)
  })
  it.each(['student', 'doc', 'requirement', 'type', 'managed'])('rejects artifact %s substitution before signing', async kind => {
    const a: any = artifact(0, 'image')
    a.storage_path = `${studentId}/${assignmentId}/${requirement(0).id}-123-${uuid(99)}.png`
    if (kind === 'student') a.student_id = actorId
    if (kind === 'doc') a.assignment_doc_id = uuid(2)
    if (kind === 'requirement') a.requirement.assignment_id = uuid(2)
    if (kind === 'type') a.requirement.type = 'link'
    if (kind === 'managed') a.managed_object_id = uuid(2)
    const f = fixture({ doc, requirements: [requirement(0, 'image')], artifacts: [a] })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 }); expect(f.bodies).toHaveLength(0)
  })
  it.each(['foreign', 'traversal', 'backslash', 'restoreWithoutRegistry'])('rejects %s image path before signing', async kind => {
    const legacy = `${studentId}/${assignmentId}/${requirement(0).id}-123-${uuid(99)}.`
    const paths = { foreign: `${uuid(8)}/${assignmentId}/${requirement(0).id}-123-${uuid(99)}.png`, traversal: `${legacy}png/../private`, backslash: `${legacy}png\\private`, restoreWithoutRegistry: `restores/${classroomId}/${uuid(7)}/${'a'.repeat(64)}-${'b'.repeat(64)}` }
    const f = fixture({ doc, requirements: [requirement(0, 'image')], artifacts: [{ ...artifact(0, 'image'), storage_path: paths[kind as keyof typeof paths] }] })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 }); expect(f.bodies).toHaveLength(0)
  })
  it.each(['upload', 'backfill', 'restore'])('signs valid %s managed namespace including unusual MIME-accepted filename', async kind => {
    const object = { id: uuid(99000), classroom_id: classroomId, data_subject_user_id: studentId, resource_type: 'assignment_doc', resource_id: doc.id,
      purpose: 'student_assignment_artifact', status: 'verified', storage_bucket: 'assignment-artifacts', storage_path: '' }
    object.storage_path = kind === 'upload' ? `classrooms/${classroomId}/students/${studentId}/assignment-docs/${doc.id}/artifacts/${object.id}.unusual $name+filename`
      : kind === 'backfill' ? `${studentId}/${assignmentId}/${requirement(0).id}-123-${uuid(99)}.unusual +file` : `restores/${classroomId}/${uuid(7)}/${'a'.repeat(64)}-${'b'.repeat(64)}`
    const a = { ...artifact(0, 'image'), managed_object_id: object.id, managed_object: object, storage_path: object.storage_path }
    const f = fixture({ doc, requirements: [requirement(0, 'image')], artifacts: [a], sign: paths => paths.map(path => ({ path, error: null, signedURL: `/object/sign/assignment-artifacts/${path}?token=fake` })) })
    expect((await f.read()).submission_artifacts[0].url).toContain('?token=fake'); expect(f.bodies).toHaveLength(1)
  })
  it('refreshes full proof before each50-image signing batch and denies the second batch on revocation', async () => {
    const requirements = Array.from({ length: 51 }, (_, n) => requirement(n, 'image'))
    const artifacts = requirements.map((r, n) => ({ ...artifact(n, 'image'), storage_path: `${studentId}/${assignmentId}/${r.id}-123-${uuid(999)}.png` }))
    const f = fixture({ doc, requirements, artifacts }); expect((await f.read()).submission_artifacts).toHaveLength(51)
    expect(f.bodies.map(b => b.paths.length)).toEqual([50, 1])
    let proofs = 0
    const lost = fixture({ doc, requirements, artifacts, intercept: (row, url) => url.searchParams.get('docs.artifacts.id')?.startsWith('in.') && ++proofs === 2 ? null : row })
    await expect(lost.read()).rejects.toMatchObject({ statusCode: 503 }); expect(lost.bodies).toHaveLength(1)
  })
  it.each(['missing', 'duplicate', 'path', 'origin', 'token', 'extraQuery', 'hash', 'noUrl'])('rejects malformed signing result %s without a partial DTO', async kind => {
    const a = { ...artifact(0, 'image'), storage_path: `${studentId}/${assignmentId}/${requirement(0).id}-123-${uuid(99)}.png` }
    const f = fixture({ doc, requirements: [requirement(0, 'image')], artifacts: [a], sign: paths => {
      const row: any = { path: paths[0], error: null, signedURL: `/object/sign/assignment-artifacts/${paths[0]}?token=fake` }
      if (kind === 'missing') return []
      if (kind === 'duplicate') return [row, row]
      if (kind === 'path') row.path = 'foreign'
      if (kind === 'origin') row.signedURL = `https://foreign.test${row.signedURL}`
      if (kind === 'token') row.signedURL = row.signedURL.replace('?token=fake', '')
      if (kind === 'extraQuery') row.signedURL += '&other=value'
      if (kind === 'hash') row.signedURL += '#fragment'
      if (kind === 'noUrl') row.signedURL = null
      return [row]
    } }); await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('retains prior per-path URLs on signing failures', async () => {
    const a = { ...artifact(0, 'image'), storage_path: `${studentId}/${assignmentId}/${requirement(0).id}-123-${uuid(99)}.png` }
    const f = fixture({ doc, requirements: [requirement(0, 'image')], artifacts: [a], sign: paths => paths.map(path => ({ path, error: 'unavailable', signedURL: null })) })
    expect((await f.read()).submission_artifacts[0].url).toBe(a.url)
  })
  it.each(['network', 'api'] as const)('retains prior URLs on SDK %s signing failure and still proves final current membership', async storageFailure => {
    const a = { ...artifact(0, 'image'), storage_path: `${studentId}/${assignmentId}/${requirement(0).id}-123-${uuid(99)}.png` }
    const f = fixture({ doc, requirements: [requirement(0, 'image')], artifacts: [a], storageFailure })
    expect((await f.read()).submission_artifacts[0].url).toBe(a.url)
    expect(f.urls.at(-1)?.searchParams.get('classrooms.target.student_id')).toBe(`eq.${studentId}`)
  })
  it.each(['invalidJson', 'object'] as const)('rejects malformed successful Storage %s responses', async kind => {
    const a = { ...artifact(0, 'image'), storage_path: `${studentId}/${assignmentId}/${requirement(0).id}-123-${uuid(99)}.png` }
    const f = fixture({ doc, requirements: [requirement(0, 'image')], artifacts: [a], storageFailure: kind === 'invalidJson' ? kind : undefined, sign: () => ({ data: null }) })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('denies final current owner/enrollment loss after successful signing without returning a partial DTO', async () => {
    const a = { ...artifact(0, 'image'), storage_path: `${studentId}/${assignmentId}/${requirement(0).id}-123-${uuid(99)}.png` }
    let signed = false
    const f = fixture({ doc, requirements: [requirement(0, 'image')], artifacts: [a], sign: paths => { signed = true; return paths.map(path => ({ path, error: null, signedURL: `/object/sign/assignment-artifacts/${path}?token=fake` })) }, intercept: row => signed ? null : row })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 }); expect(f.bodies).toHaveLength(1)
  })
  it('rejects incomplete or changed fresh signing proof before issuing links', async () => {
    const a = { ...artifact(0, 'image'), storage_path: `${studentId}/${assignmentId}/${requirement(0).id}-123-${uuid(99)}.png` }
    for (const changed of [false, true]) {
      const f = fixture({ doc, requirements: [requirement(0, 'image')], artifacts: [a], intercept: (row, url) => {
        if (url.searchParams.get('docs.artifacts.id')?.startsWith('in.')) {
          if (changed) row.docs[0].artifacts[0].storage_path = `${studentId}/${assignmentId}/${requirement(0).id}-456-${uuid(99)}.png`
          else row.docs[0].artifacts = []
        }
        return row
      } }); await expect(f.read()).rejects.toMatchObject({ statusCode: 503 }); expect(f.bodies).toHaveLength(0)
    }
  })
  it('enforces10000 collection and1024 statement caps', async () => {
    const f = fixture({ requirements: Array.from({ length: 10001 }, (_, n) => requirement(n)) })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
    const slow = fixture({ requirements: Array.from({ length: 1100 }, (_, n) => requirement(n)), cap: 1 })
    await expect(slow.read()).rejects.toMatchObject({ statusCode: 503 }); expect(slow.urls).toHaveLength(1024)
  })
  it('does not start a Storage POST when its fresh proof uses the final allowed statement', async () => {
    const requirements = Array.from({ length: 1012 }, (_, n) => requirement(n, n === 0 ? 'image' : 'link'))
    const a = { ...artifact(0, 'image'), storage_path: `${studentId}/${assignmentId}/${requirements[0].id}-123-${uuid(99)}.png` }
    const f = fixture({ doc, requirements, artifacts: [a], cap: 1 })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(f.urls).toHaveLength(1024); expect(f.urls.at(-1)?.searchParams.get('docs.artifacts.id')).toBe(`in.(${a.id})`)
    expect(f.bodies).toHaveLength(0); expect(f.urls.some(u => u.pathname.includes('/storage/'))).toBe(false)
  })
  it('does not start a Storage POST when the deadline expires after the fresh proof', async () => {
    const a = { ...artifact(0, 'image'), storage_path: `${studentId}/${assignmentId}/${requirement(0).id}-123-${uuid(99)}.png` }
    const start = Date.now(); let proofReturned = false; let callsAfterProof = 0
    const now = vi.spyOn(Date, 'now').mockImplementation(() => proofReturned && ++callsAfterProof > 1 ? start + 20000 : start)
    try {
      const f = fixture({ doc, requirements: [requirement(0, 'image')], artifacts: [a], intercept: (row, url) => {
        if (url.searchParams.get('docs.artifacts.id')?.startsWith('in.')) proofReturned = true
        return row
      } })
      await expect(f.read()).rejects.toMatchObject({ statusCode: 503 }); expect(proofReturned).toBe(true)
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(f.bodies).toHaveLength(0); expect(f.urls.some(u => u.pathname.includes('/storage/'))).toBe(false)
    } finally { now.mockRestore() }
  })
  it.each(['statement', 'json', 'depth', 'encodedDepth', 'dto'])('fails bounded %s overflow without response', async kind => {
    let deep: any = {}; for (let n = 0; n < 110; n++) deep = { child: deep }
    const f = fixture({ doc: kind === 'json' ? { ...doc, ai_grading_provenance: 'x'.repeat(2 * 1024 * 1024) } : kind === 'depth' ? { ...doc, ai_grading_provenance: deep }
      : kind === 'encodedDepth' ? { ...doc, content: JSON.stringify(deep) } : null,
    feedback: kind === 'dto' ? Array.from({ length: 16 }, (_, n) => ({ ...feedback(n), body: 'x'.repeat(600000) })) : [], cap: kind === 'dto' ? 1 : undefined,
    intercept: (row, url) => kind === 'statement' && url.searchParams.get('select')?.includes('instructions_markdown') ? { ...row, description: 'x'.repeat(8 * 1024 * 1024) } : row })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('rejects excessive JSON node counts before schema cloning', async () => {
    const f = fixture({ doc: { ...doc, ai_grading_provenance: Array.from({ length: 500001 }, () => 0) } })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
  })
})
