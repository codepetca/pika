/** Import-safe, fixed-destination HTTP boundaries for the disposable rehearsal.
 * Original upstream bytes are buffered once, validated, then released. Browser
 * navigation never owns or cancels a released upstream response read.
 */
import { createServer, request, type IncomingMessage, type RequestListener, type RequestOptions, type Server } from 'node:http'
import type { Socket } from 'node:net'
import { createContextualTestPlan, type RehearsalPlan, type ContextualTestProofScope } from '../e2e/helpers/contextual-test-rehearsal'

type Kind = 'app' | 'api'
const failureCategories = ['deadline', 'target', 'endpoint', 'request-cap', 'create-cap', 'protocol',
  'request-body', 'request-size', 'request-json', 'response-body', 'response-size', 'response-json',
  'redirect', 'upstream', 'mutation-cancelled', 'startup', 'cleanup', 'closed'] as const
export type ContextualTestGatewayFailure = typeof failureCategories[number]
const failure = () => new Error('Private contextual Test gateway')
const mib = 1048576
const hosts = { app: 'localhost:3117', api: '127.0.0.1:54340' } as const
const origins = { app: 'http://localhost:3117', api: 'http://127.0.0.1:54340' } as const
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const teacherTest = new RegExp(`^/api/teacher/tests/${uuid}(?:/(draft|markdown|results|student-access)|/students/${uuid}/grades)?$`)
const studentTest = new RegExp(`^/api/student/tests/${uuid}(?:/(attempt|results|history|session-status))?$`)
const classRead = new RegExp(`^/api/(?:teacher|student)/classrooms(?:/${uuid}(?:/(?:materials|roster|authoring-guidance))?)?$`)
const isJson = (mime: string) => /(?:^|[\/;+])json(?:\s*;|$)/i.test(mime)
// Optional Next development-overlay reads are rejected locally, like HMR. They
// must not poison the Test workflow, and are never forwarded or given source data.
function blockedDevelopmentRead(target: string, method: string): boolean {
  return method === 'POST' && target === '/__nextjs_original-stack-frames'
    || (method === 'GET' || method === 'HEAD') && /^\/__nextjs_font\/(?:geist|geist-mono)-(?:latin|latin-ext)\.woff2$/.test(target)
}

/** Reject before URL parsing can normalize traversal, authority or separators. */
export function contextualTestGatewayTarget(kind: Kind, target: string, host: unknown): string {
  if (host !== hosts[kind] || typeof target !== 'string' || target.length > 16384 || !target.startsWith('/')
    || target.startsWith('//') || /[\x00-\x20\x7f\\#]/.test(target) || /%(?![0-9a-f]{2})/i.test(target)) throw failure()
  const rawPath = target.split('?')[0]
  let decoded: string
  try { decoded = decodeURIComponent(rawPath); if (/[\x00-\x1f\x7f]/.test(decodeURIComponent(target))) throw failure() }
  catch { throw failure() }
  if (/%(?:2f|5c|25)/i.test(rawPath) || decoded.includes('//') || decoded.split('/').some(x => x === '.' || x === '..')) throw failure()
  const parsed = new URL(target, origins[kind])
  if (parsed.origin !== origins[kind] || parsed.username || parsed.password || parsed.hash || parsed.pathname !== rawPath) throw failure()
  return target
}

/** Preserve same-public-origin redirects without rewriting Host or Location. */
export function contextualTestGatewayRedirect(kind: Kind, location: string): string {
  if (typeof location !== 'string' || location.length > 16384) throw failure()
  if (location.startsWith('/')) { contextualTestGatewayTarget(kind, location, hosts[kind]); return location }
  if (!location.startsWith(origins[kind] + '/')) throw failure()
  const parsed = new URL(location)
  if (parsed.origin !== origins[kind] || parsed.username || parsed.password) throw failure()
  contextualTestGatewayTarget(kind, location.slice(origins[kind].length), hosts[kind])
  return location
}
export function contextualTestGatewayBodyLimit(kind: Kind, mime: string): number { return kind === 'api' || isJson(mime) ? mib : 64 * mib }

/** Fixed labels only: never retain paths, query values, headers or bodies. */
function endpointLabel(path: string) {
  if (path === '/__nextjs_original-stack-frames' || path === '/__nextjs_original-stack-frame') return 'framework-stack-frames'
  if (path.startsWith('/__nextjs_')) return 'framework-other'
  if (path.startsWith('/api/student/tests')) return 'student-tests'
  if (path.startsWith('/api/teacher/tests')) return 'teacher-tests'
  if (path === '/api/student/notifications') return 'student-notifications'
  if (path.startsWith('/api/student/pal/')) return 'student-pal'
  if (path.startsWith('/api/classrooms/') || classRead.test(path)) return 'classroom'
  if (path.startsWith('/rest/v1/')) return 'rest'
  return 'unknown'
}
type EndpointFailure = Readonly<{ kind: Kind; method: 'GET' | 'HEAD' | 'POST' | 'PATCH' | 'DELETE' | 'other'; route: ReturnType<typeof endpointLabel> }>
type OwnerRpcRejection = Readonly<{ operation: 'inspect' | 'results' | 'other'; reason: 'invalid-deadline' | 'invalid-input' | 'other' }>
type PolicyReceipt = { firstFailure: ContextualTestGatewayFailure | null; firstEndpointFailure: EndpointFailure | null; firstOwnerRpcRejection: OwnerRpcRejection | null; appRequests: number; apiRequests: number; creates: number; rejectedHmr: number; rejectedDiagnostics: number }
export type ContextualTestGatewayReceipt = Readonly<PolicyReceipt & {
  version: 1; started: boolean; closing: boolean; closed: boolean; pending: number; sockets: number
  jsonResponses: number; responses: number; requestBytes: number; responseBytes: number
}>

/** Endpoint policy only: no framework, browser-navigation, or body-task state. */
export class ContextualTestGatewayPolicy {
  private firstFailure: ContextualTestGatewayFailure | null = null
  private firstEndpointFailure: EndpointFailure | null = null
  private firstOwnerRpcRejection: OwnerRpcRejection | null = null
  private appRequests = 0
  private apiRequests = 0
  private creates = 0
  private rejectedHmr = 0
  private rejectedDiagnostics = 0
  private readonly classIds: ReadonlySet<string>
  private createdTestId: string | null = null
  private gradeSaves = 0
  private returns = 0
  private readonly lifecycleTests = new Set<string>()
  private readonly lifecycleCounts = new Map<string,number>()
  constructor(private readonly plan: RehearsalPlan, readonly deadline: number, private readonly now = Date.now, private readonly proofScope?: ContextualTestProofScope) {
    if (![undefined, 'vertical-v1', 'vertical-grade-return-v1','lifecycle-permissions-v1'].includes(proofScope)) this.reject('protocol')
    if ((proofScope === 'vertical-grade-return-v1' || proofScope === 'lifecycle-permissions-v1') && plan.sourceSha !== createContextualTestPlan(plan.projectId, proofScope).sourceSha) this.reject('protocol')
    this.classIds = new Set(Object.values(plan.classrooms).map(c => c.id))
    if (plan.appOrigin !== origins.app || plan.apiOrigin !== 'http://127.0.0.1:54331' || plan.retiredTestIds.length !== 2
      || !Number.isSafeInteger(deadline) || deadline <= now() || deadline - now() > 2_700_000) this.reject('deadline')
  }
  /** Only a successful real create acknowledgement can name the successor parent. */
  observeAppResponse(kind: Kind, target: string, method: string, status: number, body: unknown): void {
    if (this.proofScope === 'lifecycle-permissions-v1' && kind === 'app' && target === '/api/teacher/tests' && method === 'POST' && status === 201) {
      const test = (body as {test?:{id?:unknown;classroom_id?:unknown}})?.test
      if (!test || typeof test.id !== 'string' || !new RegExp(`^${uuid}$`).test(test.id) || test.classroom_id !== this.plan.classrooms.classA.id
        || this.plan.retiredTestIds.includes(test.id) || this.lifecycleTests.has(test.id) || this.lifecycleTests.size >= 2) this.reject('protocol')
      this.lifecycleTests.add(test.id); return
    }
    if (this.proofScope !== 'vertical-grade-return-v1' || kind !== 'app' || target !== '/api/teacher/tests' || method !== 'POST' || status !== 201) return
    const test = (body as { test?: { id?: unknown; classroom_id?: unknown } })?.test
    if (this.createdTestId || !test || typeof test.id !== 'string' || !new RegExp(`^${uuid}$`).test(test.id)
      || test.classroom_id !== this.plan.classrooms.classB.id || this.plan.retiredTestIds.includes(test.id)) this.reject('protocol')
    this.createdTestId = test.id
  }
  reject(category: ContextualTestGatewayFailure): never { this.latch(category); throw failure() }
  latch(category: ContextualTestGatewayFailure): void { this.firstFailure ??= failureCategories.includes(category) ? category : 'protocol' }
  check(): void { if (this.now() >= this.deadline) this.reject('deadline'); if (this.firstFailure) throw failure() }
  receipt(): PolicyReceipt { return { firstFailure: this.firstFailure, firstEndpointFailure: this.firstEndpointFailure, firstOwnerRpcRejection: this.firstOwnerRpcRejection, appRequests: this.appRequests, apiRequests: this.apiRequests, creates: this.creates, rejectedHmr: this.rejectedHmr, rejectedDiagnostics: this.rejectedDiagnostics } }
  /** Observe only fixed labels from already bounded/parsed JSON; forwarding and
   * acceptance are unchanged. Never retain identities, payloads or error text. */
  observeOwnerRpc(kind: Kind, target: string, method: string, status: number, requestBody: unknown, responseBody: unknown): void {
    if (this.firstOwnerRpcRejection || kind !== 'api' || target !== '/rest/v1/rpc/test_owner_workflow_v1' || method !== 'POST' || status !== 400) return
    if (!responseBody || typeof responseBody !== 'object' || Array.isArray(responseBody)) return
    const error = responseBody as Record<string, unknown>
    if (error.code !== 'PT400') return
    const operation = requestBody && typeof requestBody === 'object' && !Array.isArray(requestBody)
      ? (requestBody as Record<string, unknown>).p_operation : undefined
    this.firstOwnerRpcRejection = Object.freeze({ operation: operation === 'inspect' || operation === 'results' ? operation : 'other',
      reason: error.message === 'test_owner_invalid_deadline' ? 'invalid-deadline' : error.message === 'test_owner_invalid_input' ? 'invalid-input' : 'other' })
  }
  private charge(kind: Kind) {
    if (kind === 'app') { if (this.appRequests >= 950) this.reject('request-cap'); this.appRequests++ }
    else { if (this.apiRequests >= 4000) this.reject('request-cap'); this.apiRequests++ }
  }
  hmr(target: string, host: unknown, method: string): void {
    this.check()
    try { contextualTestGatewayTarget('app', target, host) } catch { this.reject('target') }
    if (target !== '/_next/webpack-hmr' || method !== 'GET') this.reject('protocol')
    this.charge('app'); this.rejectedHmr++
  }
  admit(kind: Kind, target: string, host: unknown, method: string, body?: unknown): void {
    this.reserve(kind, target, host, method)
    this.validateBody(kind, target, method, body)
  }
  /** Charge before body buffering so a stalled request cannot evade the cap. */
  reserve(kind: Kind, target: string, host: unknown, method: string): void {
    this.check()
    try { contextualTestGatewayTarget(kind, target, host) } catch { this.reject('target') }
    const path = target.split('?')[0], read = method === 'GET' || method === 'HEAD'
    let allowed = false
    if (kind === 'api') {
      // Same REST capability as the former server boundary, with lower request
      // and byte limits. Storage and all other Supabase services are excluded.
      allowed = /^\/rest\/v1\/(?:[a-z][a-z0-9_]*|rpc\/[a-z][a-z0-9_]*)$/.test(path)
        && ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(method)
    } else if (blockedDevelopmentRead(target, method)) {
      allowed = true
    } else if (read) {
      // Frozen app RootLayout icons and the always-mounted ClassDaysProvider
      // are shell reads even when the only enabled feature is Tests.
      const classDays = new RegExp(`^/api/classrooms/(${uuid})/class-days$`).exec(path)
      const provenance = new RegExp(`^/api/teacher/classrooms/(${uuid})/authoring-drafts/provenance$`).exec(path)
      const query = new URLSearchParams(target.includes('?') ? target.slice(target.indexOf('?') + 1) : '')
      // The editor mounts this optional metadata read; its existing role guard
      // still applies. No guided-draft creation or provider request is admitted.
      const testProvenance = !!provenance && this.classIds.has(provenance[1]) && query.size === 2
        && query.getAll('target').length === 1 && query.get('target') === 'tests'
        && query.getAll('artifact_id').length === 1 && new RegExp(`^${uuid}$`).test(query.get('artifact_id') ?? '')
      const notifications = path === '/api/student/notifications' && query.size === 1
        && query.getAll('classroom_id').length === 1 && this.classIds.has(query.get('classroom_id') ?? '')
      const lifecyclePreview = this.proofScope==='lifecycle-permissions-v1' && query.size===0
        && [...this.lifecycleTests].some(id=>path===`/classrooms/${this.plan.classrooms.classA.id}/tests/${id}/preview`)
      allowed = ['/login', '/classrooms', '/favicon.ico', '/pika-icon-light.svg', '/pika-icon-dark.svg',
        '/api/auth/me', '/api/classrooms/home', '/api/student/attendance/status', '/api/teacher/tests', '/api/student/tests'].includes(path)
        || !!(classDays && this.classIds.has(classDays[1])) || testProvenance || notifications || lifecyclePreview
        || new RegExp(`^/classrooms/${uuid}$`).test(path) || path.startsWith('/_next/static/')
        || /^\/fonts\/[a-zA-Z0-9_./-]+$/.test(path) || teacherTest.test(path) || studentTest.test(path) || classRead.test(path)
    } else {
      const successorWrite = this.proofScope === 'vertical-grade-return-v1' && this.createdTestId !== null
        && (method === 'PATCH' && path === `/api/teacher/tests/${this.createdTestId}/students/${this.plan.actors.memberTeacher.id}/grades`
          || method === 'POST' && path === `/api/teacher/tests/${this.createdTestId}/return`)
      const lifecycleWrite = this.proofScope === 'lifecycle-permissions-v1' && (
        method === 'POST' && (path === '/api/teacher/tests/reorder/atomic' || path === `/api/teacher/classrooms/${this.plan.classrooms.classA.id}/roster/remove` || path === '/api/student/classrooms/join'
          || [...this.lifecycleTests].some(id=>new RegExp(`^/api/teacher/tests/${id}/(?:return|unsubmit|unpublish|students/attempts/bulk-delete)$`).test(path)))
        || method === 'PATCH' && (path === `/api/teacher/classrooms/${this.plan.classrooms.classA.id}`
          || [...this.lifecycleTests].some(id=>new RegExp(`^/api/teacher/tests/${id}/students/${this.plan.actors.memberStudent.id}/grades$`).test(path)))
        || method === 'DELETE' && [...this.lifecycleTests].some(id=>path===`/api/teacher/tests/${id}`))
      allowed = method === 'POST' && ['/api/auth/login', '/api/teacher/tests'].includes(path)
        || method === 'PATCH' && new RegExp(`^/api/teacher/tests/${uuid}(?:/draft)?$`).test(path)
        || method === 'POST' && new RegExp(`^/api/teacher/tests/${uuid}/(?:publish|student-access)$`).test(path)
        || method === 'PATCH' && new RegExp(`^/api/student/tests/${uuid}/attempt$`).test(path)
        || method === 'POST' && new RegExp(`^/api/student/tests/${uuid}/(?:start|respond|focus-events)$`).test(path)
        || successorWrite || lifecycleWrite
    }
    if (!allowed) {
      this.firstEndpointFailure ??= Object.freeze({ kind, route: endpointLabel(path),
        method: method === 'GET' || method === 'HEAD' || method === 'POST' || method === 'PATCH' || method === 'DELETE' ? method : 'other' })
      this.reject('endpoint')
    }
    this.charge(kind)
    if (kind === 'app' && blockedDevelopmentRead(target, method)) this.rejectedDiagnostics++
  }
  validateBody(kind: Kind, target: string, method: string, body?: unknown): void {
    this.check()
    const path = target.split('?')[0]
    if (this.proofScope === 'lifecycle-permissions-v1' && kind === 'app' && !['GET','HEAD'].includes(method)) this.validateLifecycleBody(path,method,body)
    if (this.proofScope === 'vertical-grade-return-v1' && kind === 'app') {
      const exact = (value: unknown, keys: string[]): value is Record<string, unknown> => !!value && typeof value === 'object'
        && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys.sort().join(',')
      if (method === 'PATCH' && path.endsWith('/grades')) {
        if (!exact(body, ['grades']) || !Array.isArray(body.grades) || body.grades.length !== 1 || this.gradeSaves >= 1) this.reject('protocol')
        const grade = body.grades[0]
        if (!exact(grade, ['question_id','response_id','expected_response_revision','score','feedback'])
          || ![grade.question_id, grade.response_id].every(v => typeof v === 'string' && new RegExp(`^${uuid}$`).test(v))
          || !Number.isSafeInteger(grade.expected_response_revision) || Number(grade.expected_response_revision) <= 0
          || grade.score !== 4 || grade.feedback !== 'Reviewed manually') this.reject('protocol')
        this.gradeSaves++
      }
      if (method === 'POST' && path.endsWith('/return')) {
        if (!exact(body, ['student_ids']) || !Array.isArray(body.student_ids) || body.student_ids.length !== 1
          || body.student_ids[0] !== this.plan.actors.memberTeacher.id || this.returns >= 1 || this.gradeSaves !== 1) this.reject('protocol')
        this.returns++
      }
    }
    if (kind === 'app' && method === 'POST' && path === '/api/teacher/tests') {
      const row = body && typeof body === 'object' ? body as Record<string, unknown> : null
      if (!row || typeof row.classroom_id !== 'string' || !this.classIds.has(row.classroom_id) || this.creates >= (this.proofScope === 'lifecycle-permissions-v1' ? 2 : 1)) this.reject('create-cap')
      this.creates++
    }
  }
  private validateLifecycleBody(path: string, method: string, raw: unknown): void {
    const exact = (value: unknown, keys: string[]): value is Record<string,unknown> => !!value && typeof value==='object' && !Array.isArray(value)
      && Object.keys(value).sort().join(',')===[...keys].sort().join(',')
    const count = (key: string, cap: number) => { const n=this.lifecycleCounts.get(key)??0; if(n>=cap)this.reject('protocol'); this.lifecycleCounts.set(key,n+1); return n }
    const c=this.plan.classrooms.classA.id, student=this.plan.actors.memberStudent.id, teacher=this.plan.actors.memberTeacher.id
    const [main,scratch]=[...this.lifecycleTests]
    if (path==='/api/auth/login') return
    if (path==='/api/teacher/tests') { if (!exact(raw,['classroom_id']) || raw.classroom_id!==c) this.reject('protocol'); return }
    if(path===`/api/teacher/classrooms/${c}/roster/remove`) {
      if(!exact(raw,['roster_ids']) || !Array.isArray(raw.roster_ids) || raw.roster_ids.length!==1 || raw.roster_ids[0]!==this.plan.lifecycleRoster?.id)this.reject('protocol')
      count('remove',1); return
    }
    if(path==='/api/student/classrooms/join') {
      if(!exact(raw,['classCode','firstName','lastName']) || raw.classCode!==this.plan.classrooms.classA.classCode || raw.firstName!=='Synthetic' || raw.lastName!=='Learner')this.reject('protocol')
      if(this.lifecycleCounts.get('remove')!==1)this.reject('protocol');count('rejoin',1); return
    }
    if(path===`/api/teacher/classrooms/${c}`) {
      if(!exact(raw,['archived']) || raw.archived!==(count('archive',2)===0))this.reject('protocol'); return
    }
    if(path==='/api/teacher/tests/reorder/atomic') {
      if(!exact(raw,['classroom_id','test_ids']) || raw.classroom_id!==c || !Array.isArray(raw.test_ids) || raw.test_ids.length<2 || raw.test_ids.length>3
        || new Set(raw.test_ids).size!==raw.test_ids.length || !raw.test_ids.every(id=>typeof id==='string' && (this.lifecycleTests.has(id)||this.plan.retiredTestIds.includes(id))))this.reject('protocol')
      const index=count('reorder',2),expected=index===0?[this.plan.retiredTestIds[0],scratch,main]:[main,this.plan.retiredTestIds[1]]
      if(JSON.stringify(raw.test_ids)!==JSON.stringify(expected))this.reject('protocol'); return
    }
    if(path.endsWith('/grades')) {
      if(path!==`/api/teacher/tests/${main}/students/${student}/grades`)this.reject('protocol')
      if(!exact(raw,['grades']) || !Array.isArray(raw.grades) || raw.grades.length!==1)this.reject('protocol')
      const g=raw.grades[0], index=count('grades',4)
      if(!exact(g,index===3?['question_id','response_id','expected_response_revision','clear_grade']:['question_id','response_id','expected_response_revision','score','feedback'])
        || ![g.question_id,g.response_id].every(v=>typeof v==='string'&&new RegExp(`^${uuid}$`).test(v)) || !Number.isSafeInteger(g.expected_response_revision)||Number(g.expected_response_revision)<1
        || (index===3?g.clear_grade!==true:g.score!==(index===0?2:4)||g.feedback!==(index===0?'Concurrent owner session':'Lifecycle manual feedback')))this.reject('protocol')
      return
    }
    if(path.endsWith('/return') || path.endsWith('/unsubmit') || path.endsWith('/bulk-delete')) {
      if(!exact(raw,['student_ids'])||!Array.isArray(raw.student_ids)||raw.student_ids.length<1||raw.student_ids.length>2||new Set(raw.student_ids).size!==raw.student_ids.length
        ||!raw.student_ids.every(id=>id===student||id===teacher))this.reject('protocol')
      const reset=path.endsWith('/bulk-delete'),unsubmit=path.endsWith('/unsubmit')
      const index=count(reset?'reset':unsubmit?'unsubmit':'return',reset?2:1)
      const parent=reset||unsubmit?scratch:main
      if(!path.startsWith(`/api/teacher/tests/${parent}/`) || raw.student_ids.length!==(reset&&index===1?2:1)
        || !raw.student_ids.includes(student))this.reject('protocol'); return
    }
    const parent = new RegExp(`^/api/(?:teacher|student)/tests/(${uuid})(?:/|$)`).exec(path)?.[1]
    if (!parent || (!this.lifecycleTests.has(parent) && !(method==='PATCH' && path===`/api/teacher/tests/${this.plan.retiredTestIds[1]}`)))this.reject('protocol')
    if (method==='DELETE') { if(path!==`/api/teacher/tests/${scratch}` || raw!==undefined && raw!==null)this.reject('protocol'); count('delete',1) }
    if(path.endsWith('/unpublish')) { if(!exact(raw,[]))this.reject('protocol'); count('unpublish',2) }
    if(path.endsWith('/publish')) {
      if(!exact(raw,['status','draft_version']) || raw.status!=='closed'||!Number.isSafeInteger(raw.draft_version)||Number(raw.draft_version)<1)this.reject('protocol')
      count('publish',3)
    }
  }
}

/** Replace only I/O for CPU tests; production always uses fixed literal peers. */
export type ContextualTestGatewayEdges = {
  now(): number
  createServer(listener: RequestListener): Server
  request(options: RequestOptions, callback: (response: IncomingMessage) => void): ReturnType<typeof request>
}
const defaultEdges: ContextualTestGatewayEdges = {
  now: Date.now,
  createServer: listener => createServer({ maxHeaderSize: 16384, requestTimeout: 30000, headersTimeout: 30000, keepAliveTimeout: 1000 }, listener),
  request: (options, callback) => request(options, callback),
}
const hop = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'])
function headersWithoutHop(headers: IncomingMessage['headers']): Record<string, string | string[]> {
  const connection = typeof headers.connection === 'string' ? headers.connection.toLowerCase().split(',').map(x => x.trim()) : []
  const result: Record<string, string | string[]> = Object.create(null)
  for (const [key, value] of Object.entries(headers)) if (value !== undefined && !hop.has(key.toLowerCase()) && !connection.includes(key.toLowerCase())) result[key] = value
  return result
}
function parseJson(bytes: Buffer): unknown { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }

export function createContextualTestGateways(input: { plan: RehearsalPlan; deadline: number; proofScope?: ContextualTestProofScope }, edges: ContextualTestGatewayEdges = defaultEdges) {
  const deadline = input.deadline
  const policy = new ContextualTestGatewayPolicy(input.plan, deadline, edges.now, input.proofScope)
  const sockets = new Set<Socket>(), pending = new Set<Promise<void>>()
  const active = new Map<Promise<void>, { end: number; abort(): void }>()
  const listeners = new Set<Server>()
  let started = false, closing = false, closed = false, startAttempted = false
  let jsonResponses = 0, responses = 0, requestBytes = 0, responseBytes = 0
  function trackSocket(socket: Socket) {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket))
    if (sockets.size > 128) { policy.latch('request-cap'); socket.destroy() }
  }
  const receipt = (): ContextualTestGatewayReceipt => {
    if (!closed && edges.now() >= deadline) policy.latch('deadline')
    return Object.freeze({ version: 1, ...policy.receipt(), started, closing, closed,
      pending: pending.size, sockets: sockets.size, jsonResponses, responses, requestBytes, responseBytes })
  }
  const check = () => {
    policy.check()
    if (closing || closed) policy.reject('closed')
    if ([...active.values()].some(task => edges.now() >= task.end)) policy.reject('deadline')
  }
  function handler(kind: Kind): RequestListener {
    return (incoming, outgoing) => {
      let upstream: ReturnType<typeof request> | undefined, original: IncomingMessage | undefined
      let ended = false, dispatched = false, detached = false, resolve!: () => void
      const work = new Promise<void>(done => { resolve = done })
      const end = Math.min(deadline, edges.now() + 30000)
      const failResponse = () => { if (!outgoing.destroyed && !outgoing.writableEnded) outgoing.destroy() }
      const abort = () => { upstream?.destroy(); original?.destroy(); incoming.destroy(); failResponse() }
      pending.add(work); active.set(work, { end, abort })
      const timer = setTimeout(() => { policy.latch('deadline'); abort(); finish() }, Math.max(0, end - edges.now()))
      const finish = () => { if (ended) return; ended = true; clearTimeout(timer); pending.delete(work); active.delete(work); resolve() }
      const failed = (category: ContextualTestGatewayFailure) => { policy.latch(category); abort(); finish() }
      outgoing.on('error', () => { detached = true; if (dispatched && !['GET', 'HEAD'].includes(incoming.method ?? '')) policy.latch('mutation-cancelled') })
      outgoing.on('close', () => {
        if (!outgoing.writableEnded) { detached = true; if (dispatched && !['GET', 'HEAD'].includes(incoming.method ?? '')) policy.latch('mutation-cancelled') }
      })
      const task = async () => {
        try {
          check()
          const method = incoming.method ?? '', target = incoming.url ?? ''
          try { contextualTestGatewayTarget(kind, target, incoming.headers.host) } catch { policy.reject('target') }
          if (incoming.headers.origin !== undefined && incoming.headers.origin !== origins.app) policy.reject('target')
          policy.reserve(kind, target, incoming.headers.host, method)
          if (pending.size > 64) policy.reject('request-cap')
          const seen = new Set<string>()
          for (let i = 0; i < incoming.rawHeaders.length; i += 2) {
            const name = incoming.rawHeaders[i].toLowerCase()
            if (['host', 'origin', 'content-length', 'transfer-encoding'].includes(name) && seen.has(name)) policy.reject('protocol')
            seen.add(name)
          }
          const length = incoming.headers['content-length']
          if (length !== undefined && (typeof length !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(length) || Number(length) > mib)) policy.reject('request-size')
          const bytes = await new Promise<Buffer>((done, reject) => {
            const chunks: Buffer[] = []; let size = 0, complete = false, rejected = false
            incoming.on('data', (chunk: Buffer) => {
              if (rejected) return
              if (chunk.length > mib - size) { rejected = true; policy.latch('request-size'); incoming.pause(); reject(failure()); return }
              size += chunk.length
              chunks.push(Buffer.from(chunk))
            })
            incoming.once('end', () => { complete = true; if (!rejected) done(Buffer.concat(chunks, size)) })
            incoming.once('aborted', () => reject(failure()))
            incoming.once('error', () => reject(failure()))
            incoming.once('close', () => { if (!complete) reject(failure()) })
          }).catch(() => policy.reject(policy.receipt().firstFailure ?? 'request-body'))
          requestBytes += bytes.length
          if (ended) return
          if (edges.now() >= end) policy.reject('deadline')
          if (closing) { if (!['GET', 'HEAD'].includes(method)) policy.latch('mutation-cancelled'); finish(); return }
          let body: unknown
          const developmentRead = kind === 'app' && blockedDevelopmentRead(target, method)
          if (bytes.length) {
            if (['GET', 'HEAD'].includes(method) || (!developmentRead && !isJson(String(incoming.headers['content-type'] ?? '')))) policy.reject('request-json')
            try { body = parseJson(bytes) } catch { policy.reject('request-json') }
          }
          policy.validateBody(kind, target, method, body)
          if (developmentRead) {
            // A real empty denial, not a fabricated app/API success. Next falls
            // back to its existing unmapped stack and local fallback fonts.
            if (!detached && !outgoing.destroyed) { outgoing.writeHead(404, { 'content-length': '0' }); outgoing.end() }
            finish(); return
          }
          if (detached) { if (!['GET', 'HEAD'].includes(method)) policy.reject('mutation-cancelled'); finish(); return }
          const headers = headersWithoutHop(incoming.headers)
          headers.host = hosts[kind]; headers['accept-encoding'] = 'identity'; headers['content-length'] = String(bytes.length)
          delete headers.expect
          dispatched = true
          upstream = edges.request({ hostname: '127.0.0.1', port: kind === 'app' ? 3118 : 54331, method, path: target, headers, agent: false }, response => {
            original = response
            if (ended) { response.destroy(); return }
            try {
              if (edges.now() >= end) policy.reject('deadline')
              const mime = String(response.headers['content-type'] ?? ''), json = isJson(mime)
              const cap = contextualTestGatewayBodyLimit(kind, mime)
              const responseLength = response.headers['content-length']
              if (responseLength !== undefined && (typeof responseLength !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(responseLength) || Number(responseLength) > cap)) policy.reject('response-size')
              if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') policy.reject('response-body')
              const location = response.headers.location
              if (location !== undefined) { try { contextualTestGatewayRedirect(kind, location) } catch { policy.reject('redirect') } }
              const chunks: Buffer[] = []; let size = 0, complete = false
              response.on('data', (chunk: Buffer) => {
                if (ended) return
                size += chunk.length
                if (size > cap) { failed('response-size'); return }
                chunks.push(Buffer.from(chunk))
              })
              response.once('aborted', () => { if (!ended) failed('response-body') })
              response.once('error', () => { if (!ended) failed('response-body') })
              response.once('close', () => { if (!complete && !ended) failed('response-body') })
              response.once('end', () => {
                complete = true
                if (ended) return
                try {
                  if (edges.now() >= end) policy.reject('deadline')
                  const originalBytes = Buffer.concat(chunks, size)
                  if (method !== 'HEAD' && ![204, 304].includes(response.statusCode ?? 0)
                    && responseLength !== undefined && Number(responseLength) !== size) policy.reject('response-body')
                  if (method !== 'HEAD' && ![204, 304].includes(response.statusCode ?? 0) && json) {
                    let parsed: unknown
                    try { parsed = parseJson(originalBytes) } catch { policy.reject('response-json') }
                    policy.observeOwnerRpc(kind, target, method, response.statusCode ?? 0, body, parsed)
                    policy.observeAppResponse(kind, target, method, response.statusCode ?? 0, parsed)
                    jsonResponses++
                  }
                  responseBytes += size; responses++
                  if (!detached && !outgoing.destroyed) {
                    const responseHeaders = headersWithoutHop(response.headers)
                    responseHeaders['content-length'] = String(size)
                    outgoing.writeHead(response.statusCode ?? 502, responseHeaders); outgoing.end(originalBytes)
                  }
                  finish()
                } catch { failed(policy.receipt().firstFailure ?? 'response-body') }
              })
            } catch { failed(policy.receipt().firstFailure ?? 'response-body') }
          })
          upstream.once('error', () => { if (!ended) failed('upstream') })
          upstream.once('socket', trackSocket)
          upstream.end(bytes)
        } catch { failed(policy.receipt().firstFailure ?? 'upstream') }
      }
      void task()
    }
  }
  async function start(): Promise<void> {
    check()
    if (startAttempted) policy.reject('startup')
    startAttempted = true
    let servers: Array<{ kind: Kind; server: Server }> = []
    try {
      servers = (['app', 'api'] as const).map(kind => {
        const server = edges.createServer(handler(kind)); listeners.add(server)
        server.on('connection', (socket: Socket) => { trackSocket(socket); if (closing) socket.destroy() })
        server.on('clientError', (_error, socket: Socket) => { policy.latch('protocol'); socket.destroy() })
        server.on('connect', (_incoming, socket: Socket) => { policy.latch('protocol'); socket.destroy() })
        server.on('upgrade', (incoming: IncomingMessage, socket: Socket) => {
          try { if (kind !== 'app') policy.reject('protocol'); policy.hmr(incoming.url ?? '', incoming.headers.host, incoming.method ?? '') }
          catch { policy.latch('protocol') }
          socket.destroy()
        })
        return { kind, server }
      })
    } catch { policy.reject('startup') }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        Promise.all(servers.map(({ kind, server }) => new Promise<void>((resolve, reject) => {
          server.once('error', () => { policy.latch('startup'); reject(failure()) })
          server.listen(kind === 'app' ? 3117 : 54340, '127.0.0.1', resolve)
        }))),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => {
          policy.latch('deadline'); reject(failure())
        }, Math.max(0, Math.min(deadline, edges.now() + 30000) - edges.now())) }),
      ])
      check(); started = true
    } catch { policy.reject('startup') }
    finally { clearTimeout(timer) }
  }
  let closure: Promise<void> | undefined
  function close(cleanupDeadline: number): Promise<void> {
    if (closure) return closure
    closing = true
    if (edges.now() >= deadline) policy.latch('deadline')
    closure = (async () => {
      if (!Number.isSafeInteger(cleanupDeadline) || cleanupDeadline <= edges.now()) { policy.latch('cleanup'); throw failure() }
      const listenerClosures = [...listeners].map(server => new Promise<void>((resolve, reject) => {
        server.close(error => { if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') reject(failure()); else resolve() })
        server.closeIdleConnections()
      }))
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          (async () => {
            await Promise.all([...pending])
            for (const socket of sockets) socket.destroy()
            await Promise.all(listenerClosures)
            if (sockets.size) await new Promise<void>(resolve => {
              const remaining = [...sockets]; let count = remaining.length
              for (const socket of remaining) socket.once('close', () => { if (!--count) resolve() })
              if (!count) resolve()
            })
          })(),
          new Promise<never>((_resolve, reject) => { timer = setTimeout(() => {
            policy.latch('cleanup'); for (const task of active.values()) task.abort(); for (const socket of sockets) socket.destroy(); reject(failure())
          }, Math.max(0, cleanupDeadline - edges.now())) }),
        ])
        if (pending.size || sockets.size || edges.now() >= cleanupDeadline) { policy.latch('cleanup'); throw failure() }
        closed = true
      } catch { policy.latch('cleanup'); throw failure() }
      finally { clearTimeout(timer) }
    })()
    return closure
  }
  return Object.freeze({ start, close, check, receipt })
}
