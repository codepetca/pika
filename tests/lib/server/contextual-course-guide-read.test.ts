import { describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { readContextualCourseGuide } from '@/lib/server/contextual-course-guide-read'
import { contextualCourseGuideReadControlEnvelopeSchema } from '@/lib/validations/contextual-course-guide-read'
import type { Database } from '@/types/database'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const now = new Date('2026-10-03T12:00:00.123Z')
const hidden = { overview: false, resources: false, assignments: false, tests: false }
const assignment = (n: number) => ({ id: id(n), classroom_id: classroomId, position: n - 5, title: 'Same', is_draft: false, released_at: null as string | null })
const test = (n: number) => ({ id: id(n), classroom_id: classroomId, position: n - 5, title: 'Same', status: 'active' })
function fixture(options: {
  member?: boolean; config?: unknown; feature?: unknown; archived?: string | null;
  assignments?: unknown[][]; tests?: unknown[][]; content?: unknown;
  intercept?: (row: unknown, url: URL, index: number) => unknown;
} = {}) {
  const urls: URL[] = []
  const signals: Array<AbortSignal | null | undefined> = []
  let assignmentPage = 0
  let testPage = 0
  const root = { id: classroomId, teacher_id: options.member ? otherId : actorId, archived_at: options.archived ?? null }
  const control = { ...root, actual_site_config: 'config' in options ? options.config : hidden, feature_visibility: 'feature' in options ? options.feature : {} }
  const fetcher = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(request)); urls.push(url); signals.push(init?.signal)
    const select = url.searchParams.get('select') ?? ''
    let row: unknown = url.pathname.endsWith('/classroom_enrollments') ? { classroom_id: classroomId, student_id: actorId }
      : select === 'id,teacher_id,archived_at' ? root
      : {
        ...control,
        ...(options.member ? { membership: [{ classroom_id: classroomId, student_id: actorId }] } : {}),
        ...(select.includes('feature_visibility,title') ? { title: 'Course' } : {}),
        ...(select.includes('course_overview_markdown') ? { course_overview_markdown: 'Overview' } : {}),
        ...(select.includes('resources:') ? { resources: options.content === undefined ? null : { id: id(900), classroom_id: classroomId, content: options.content } } : {}),
        ...(select.includes('assignments:') ? { assignments: options.assignments?.[assignmentPage++] ?? [] } : {}),
        ...(select.includes('tests:') ? { tests: options.tests?.[testPage++] ?? [] } : {}),
      }
    if (options.intercept) row = options.intercept(row, url, urls.length - 1)
    return new Response(JSON.stringify(row), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  const supabase = createClient<Database>('http://127.0.0.1:54321', 'fake-service-key', { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } })
  return { supabase, urls, signals, fetcher, read: () => readContextualCourseGuide({ supabase, actorId, classroomId, now }) }
}

describe('bounded actor-bound CourseGuide reads (installed SDK, no network)', () => {
  it.each([false, true])('omits all hidden payload joins and repeats authority/config through final control (member=%s)', async member => {
    const f = fixture({ member })
    await expect(f.read()).resolves.toEqual({ classroom: { title: 'Course' }, visibility: hidden, overviewMarkdown: '', resourcesContent: null, assignments: [], tests: [] })
    const controls = f.urls.filter(url => url.searchParams.has('actual_site_config'))
    expect(controls).toHaveLength(2)
    for (const url of controls) {
      expect(url.searchParams.get('actual_site_config')).toBe(`eq.${JSON.stringify(hidden)}`)
      expect(url.searchParams.get('teacher_id')).toBe(`${member ? 'neq' : 'eq'}.${actorId}`)
      if (member) {
        expect(url.searchParams.get('feature_visibility')).toBe('eq.{}')
        expect(url.searchParams.get('membership.student_id')).toBe(`eq.${actorId}`)
        expect(url.searchParams.get('archived_at')).toBe('is.null')
      }
      expect(url.searchParams.get('select')).not.toMatch(/resources:|assignments:|tests:|course_overview_markdown/)
    }
    expect(f.signals.every(signal => signal === f.signals[0] && signal !== undefined)).toBe(true)
  })

  it.each([null, 4, 'legacy', {}, { assignments: 'yes', overview: false }])('preserves normalization for raw config %# and exact JSONB equality', async config => {
    const f = fixture({ config })
    const guide = await f.read()
    expect(guide.visibility.assignments).toBe(true)
    expect(f.urls[2].searchParams.get('actual_site_config')).toBe(`eq.${JSON.stringify(config)}`)
  })

  it('reads both >1000 collections through short pages, stable keys, publication cutoff and terminal/final proof', async () => {
    const assignments = Array.from({ length: 1005 }, (_, n) => assignment(n + 1))
    assignments[0].released_at = '2026-10-03T12:00:00.123999Z'
    const tests = Array.from({ length: 1005 }, (_, n) => test(n + 1))
    tests[0].status = 'closed'
    const f = fixture({ config: { ...hidden, assignments: true, tests: true }, assignments: [assignments.slice(0, 1000), assignments.slice(1000, 1001), assignments.slice(1001), []], tests: [tests.slice(0, 1000), tests.slice(1000), []] })
    const guide = await f.read()
    expect(guide.assignments).toHaveLength(1005); expect(guide.tests).toHaveLength(1005)
    expect(guide.assignments[1004]).toEqual({ key: 'assignment:1004', title: 'Same' })
    const pages = f.urls.filter(url => url.searchParams.has('assignments.limit'))
    expect(pages).toHaveLength(4)
    for (const url of pages) {
      expect(url.searchParams.get('assignments.order')).toBe('position.asc,id.asc')
      expect(url.searchParams.get('assignments.limit')).toBe('1000')
      expect(url.searchParams.get('assignments.is_draft')).toBe('eq.false')
      expect(url.searchParams.get('assignments.or')).toContain('released_at.lt.2026-10-03T12:00:00.124Z')
      expect(url.searchParams.has('actual_site_config')).toBe(true)
      expect(url.searchParams.get('select')).not.toMatch(/answer|question|document|grading|lesson|announcement/)
    }
    expect(pages[1].searchParams.get('assignments.or')).toBe(`(and(or(released_at.is.null,released_at.lt.2026-10-03T12:00:00.124Z),or(position.gt.${assignments[999].position},and(position.eq.${assignments[999].position},id.gt.${assignments[999].id}))))`)
    expect(f.urls.at(-1)?.searchParams.get('select')).not.toMatch(/assignments:|tests:|title/)
  })

  it.each([2, 3, 4, 5])('discards all data on revocation at header/page/terminal/final statement %s', async boundary => {
    const f = fixture({ config: { ...hidden, assignments: true }, assignments: [[assignment(1)], []], intercept: (row, _url, index) => index === boundary ? null : row })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 403 })
  })
  it.each([2, 3, 4, 5])('discards all data on raw config mismatch at statement %s', async boundary => {
    const f = fixture({ config: { ...hidden, assignments: true }, assignments: [[assignment(1)], []], intercept: (row, _url, index) => index === boundary ? { ...Object(row), actual_site_config: hidden } : row })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('compares JSON semantically while accepting object key order', async () => {
    const f = fixture({ intercept: (row, _url, index) => index >= 2 ? { ...Object(row), actual_site_config: { tests: false, assignments: false, resources: false, overview: false } } : row })
    await expect(f.read()).resolves.toMatchObject({ visibility: hidden })
  })
  it('allows archived owner precedence and denies archived/syllabus-disabled member before payload', async () => {
    await expect(fixture({ archived: now.toISOString() }).read()).resolves.toMatchObject({ visibility: hidden })
    for (const f of [fixture({ member: true, archived: now.toISOString() }), fixture({ member: true, feature: { syllabus: false } })]) {
      await expect(f.read()).rejects.toMatchObject({ statusCode: 403 })
      expect(f.urls.some(url => url.searchParams.get('select')?.includes(',title'))).toBe(false)
    }
  })
  it.each([null, 'invalid json', { type: 'doc', content: [] }, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: '/image' } }] }] }])('retains empty resource semantics %# and object/null FK wire shape', async content => {
    const f = fixture({ config: { ...hidden, resources: true }, content })
    await expect(f.read()).resolves.toMatchObject({ resourcesContent: null })
    expect(f.urls[2].searchParams.get('select')).toContain('resources:classroom_resources!classroom_materials_classroom_id_fkey(id,classroom_id,content)')
  })
  it('hydrates historical serialized Tiptap text', async () => {
    const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] }
    await expect(fixture({ config: { ...hidden, resources: true }, content: JSON.stringify(content) }).read()).resolves.toMatchObject({ resourcesContent: content })
  })
  it.each(['overview', 'resources', 'assignments', 'tests'] as const)('selects only the independently enabled %s projection', async enabled => {
    const f = fixture({ config: { ...hidden, [enabled]: true } })
    const guide = await f.read()
    expect(guide.visibility).toEqual({ ...hidden, [enabled]: true })
    const selects = f.urls.map(url => url.searchParams.get('select') ?? '').join(' ')
    expect(selects.includes('course_overview_markdown')).toBe(enabled === 'overview')
    for (const kind of ['resources', 'assignments', 'tests']) expect(selects.includes(`${kind}:`)).toBe(kind === enabled)
  })
  it('retains tied and negative position order, duplicate titles and empty-title fallbacks', async () => {
    const rows = [{ ...assignment(1), position: -2, title: '' }, { ...assignment(2), position: -2 }, { ...assignment(3), position: -1 }]
    const f = fixture({ config: { ...hidden, assignments: true, tests: true }, assignments: [rows.slice(0, 1), rows.slice(1), []], tests: [[{ ...test(1), title: '' }], []] })
    const guide = await f.read()
    expect(guide.assignments).toEqual([{ key: 'assignment:0', title: 'Untitled assignment' }, { key: 'assignment:1', title: 'Same' }, { key: 'assignment:2', title: 'Same' }])
    expect(guide.tests).toEqual([{ key: 'test:0', title: 'Untitled test' }])
    expect(f.urls.find(url => url.searchParams.has('tests.limit'))?.searchParams.get('tests.status')).toBe('neq.draft')
  })
  it.each([null, [], {}, [{ classroom_id: classroomId, student_id: actorId }, { classroom_id: classroomId, student_id: actorId }], [{ classroom_id: otherId, student_id: actorId }], [{ classroom_id: classroomId, student_id: otherId }]])('rejects member relationship/cardinality substitution %#', async membership => {
    const f = fixture({ member: true, intercept: (row, _url, index) => index === 2 ? { ...Object(row), membership } : row })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each([3, 4])('guards the member syllabus through header/final (statement %s)', async boundary => {
    const f = fixture({ member: true, intercept: (row, _url, index) => index === boundary ? { ...Object(row), feature_visibility: { syllabus: false } } : row })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
    expect(f.urls[boundary].searchParams.get('feature_visibility')).toBe('eq.{}')
  })
  it.each([{ teacher_id: otherId }, { id: otherId }, { title: null }, { title: undefined }, { resources: [] }, { resources: [{ id: id(1), classroom_id: classroomId, content: null }] }, { resources: { id: id(1), classroom_id: otherId, content: null } }, { questions: [] }])('rejects header identity/cardinality/extra/missing values %#', async patch => {
    const f = fixture({ config: { ...hidden, resources: true }, intercept: (row, _url, index) => index === 2 ? { ...Object(row), ...patch } : row })
    await expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each([{ status: 'draft' }, { status: 'unexpected' }, { status: null }, { classroom_id: otherId }, { questions: [] }])('rejects malformed or unpublished tests %#', async patch => {
    await expect(fixture({ config: { ...hidden, tests: true }, tests: [[{ ...test(1), ...patch }]] }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('maps missing/removed preflights and transports without retries or leaking details', async () => {
    const missing = fixture({ intercept: (row, _url, index) => index === 0 ? null : row })
    await expect(missing.read()).rejects.toMatchObject({ statusCode: 404 })
    const removed = fixture({ member: true, intercept: (row, _url, index) => index === 1 ? null : row })
    await expect(removed.read()).rejects.toMatchObject({ statusCode: 403 })
    const transport = fixture()
    transport.fetcher.mockRejectedValue(new Error('private backend detail'))
    await expect(transport.read()).rejects.toMatchObject({ statusCode: 503, message: 'Unable to verify classroom course guide' })
    expect(transport.fetcher).toHaveBeenCalledTimes(1)
  })
  it('aborts the overall deadline even when a transport ignores cancellation', async () => {
    vi.useFakeTimers()
    try {
      const f = fixture(); f.fetcher.mockImplementation(() => new Promise<Response>(() => {}))
      const pending = expect(f.read()).rejects.toMatchObject({ statusCode: 503 })
      await vi.advanceTimersByTimeAsync(20000)
      await pending
      expect(f.fetcher).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })
  it('rejects invalid identity and clock before database access', async () => {
    const f = fixture()
    await expect(readContextualCourseGuide({ supabase: f.supabase, actorId: 'bad', classroomId })).rejects.toMatchObject({ statusCode: 400 })
    await expect(readContextualCourseGuide({ supabase: f.supabase, actorId, classroomId, now: new Date('invalid') })).rejects.toMatchObject({ statusCode: 503 })
    expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('discards an oversized final DTO', async () => {
    await expect(fixture({ config: { ...hidden, assignments: true }, assignments: [[{ ...assignment(1), title: 'x'.repeat(4 * 1024 * 1024) }], []] }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('rejects deeply nested parsed Tiptap before recursive emptiness evaluation', async () => {
    let node: unknown = { type: 'text', text: 'text' }
    for (let n = 0; n < 101; n++) node = { type: 'paragraph', content: [node] }
    await expect(fixture({ config: { ...hidden, resources: true }, content: { type: 'doc', content: [node] } }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('keeps own null/scalar/raw JSON evidence and Zod clone semantic behavior', () => {
    const raw = { data: { id: classroomId, teacher_id: actorId, archived_at: null, actual_site_config: { tests: false, nested: { b: 2, a: 1 } }, feature_visibility: null }, error: null }
    const parsed = contextualCourseGuideReadControlEnvelopeSchema.parse(raw)
    expect(parsed.data?.actual_site_config).toEqual(raw.data.actual_site_config)
    expect(parsed.data?.actual_site_config).not.toBe(raw.data.actual_site_config)
    raw.data.actual_site_config.nested.b = 7
    expect(parsed.data?.actual_site_config).toEqual({ tests: false, nested: { b: 2, a: 1 } })
  })
  it.each([{ is_draft: true }, { released_at: '2026-10-03T12:00:00.124001Z' }, { released_at: 'invalid' }, { classroom_id: otherId }, { answer: 'secret' }, { position: 1.5 }])('rejects invalid/substituted/unpublished assignment %#', async patch => {
    await expect(fixture({ config: { ...hidden, assignments: true }, assignments: [[{ ...assignment(1), ...patch }]] }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each([[assignment(1), assignment(1)], [assignment(2), assignment(1)]])('rejects repeated/backward cursor %#', async rows => {
    await expect(fixture({ config: { ...hidden, assignments: true }, assignments: [rows] }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('requires terminal at exact row bound and fails one over without truncation', async () => {
    const rows = Array.from({ length: 10000 }, (_, n) => assignment(n + 1))
    const pages = Array.from({ length: 10 }, (_, n) => rows.slice(n * 1000, (n + 1) * 1000))
    const exact = fixture({ config: { ...hidden, assignments: true }, assignments: [...pages, []] })
    expect((await exact.read()).assignments).toHaveLength(10000)
    expect(exact.urls.filter(url => url.searchParams.has('assignments.limit'))).toHaveLength(11)
    await expect(fixture({ config: { ...hidden, assignments: true }, assignments: [...pages, [assignment(10001)]] }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('fails short-page stream exhaustion and malformed/excessive resources/config', async () => {
    await expect(fixture({ config: { ...hidden, assignments: true }, assignments: Array.from({ length: 65 }, (_, n) => [assignment(n + 1)]) }).read()).rejects.toMatchObject({ statusCode: 503 })
    for (const content of [{ type: 'doc', content: [null] }, 'x'.repeat(2 * 1024 * 1024 + 1)]) {
      await expect(fixture({ config: { ...hidden, resources: true }, content }).read()).rejects.toMatchObject({ statusCode: 503 })
    }
    await expect(fixture({ config: 'x'.repeat(4097) }).read()).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each([{}, { data: null }, { error: null }, Object.create({ data: null, error: null }), { data: undefined, error: null }, { data: null, error: null, status: 500 }])('strict own SDK envelope rejects malformed %#', value => {
    expect(contextualCourseGuideReadControlEnvelopeSchema.safeParse(value).success).toBe(false)
  })
})
