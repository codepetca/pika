/** Browser-only portion of the existing finite rehearsal boundary. Import-safe.
 * Original Response bytes, never a browser-evaluated or replayed substitute.
 */
import type { RehearsalPlan } from './contextual-test-rehearsal'
import { types } from 'node:util'

type Failure = 'deadline' | 'failed' | 'origin' | 'endpoint' | 'request-cap' | 'test-cap' | 'upload-cap'
  | 'storage-method' | 'storage-reservation' | 'storage-bytes' | 'response-body' | 'response-cap'
  | 'response-json' | 'response-acknowledgement' | 'response-original-incompatible' | 'context-close'
type OriginalResponse = { url(): string; status(): number; headers(): Record<string, string>; body(): Promise<Buffer> }
type Reservation = { testId: string; bytes: number; url: string | null; readPath: string | null; managedId: string | null; uploaded: boolean }
type Task = { promise: Promise<unknown>; end: number; kind: 'transport' | 'body' }
const endpointReasons = ['prohibited-api', 'navigation-pending', 'navigation-before-login',
  'route-inspection', 'route-continue', 'websocket', 'unspecified'] as const
type EndpointReason = typeof endpointReasons[number]
type EndpointFailure = { reason: EndpointReason; transports: number; bodies: number }
type RequestFailure = {
  reason: 'malformed-url' | 'credentials' | 'protocol' | 'origin';
  target: 'app' | 'storage' | 'google-font-stylesheet' | 'google-font-file' | 'other';
  method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'other';
  resource: 'document' | 'stylesheet' | 'font' | 'script' | 'image' | 'fetch' | 'xhr' | 'api' | 'other';
}
type ResponseFailure = {
  phase: Failure; resource: 'login' | 'session' | 'test-api' | 'other';
  status: 'success' | 'redirect' | 'client-error' | 'server-error' | 'other';
  cause: 'inspector-resource-unavailable' | 'redirect-body-unavailable' | 'target-closed' | 'unknown';
}
/** Classify known library failures without retaining their text, stack, URL or
 * hash. Never invoke a thrown object's getter, proxy trap or coercion. */
function bodyFailureCause(error: unknown): ResponseFailure['cause'] {
  if (!error || typeof error !== 'object' || types.isProxy(error) || !types.isNativeError(error)) return 'unknown'
  const descriptor = Object.getOwnPropertyDescriptor(error, 'message')
  const message: unknown = descriptor && 'value' in descriptor ? descriptor.value : undefined
  if (typeof message !== 'string' || message.length > 16384) return 'unknown'
  if (message.includes('Network.getResponseBody') && ['No resource with given identifier found', 'No data found for resource with given identifier', 'Request content was evicted from inspector cache'].some(text => message.includes(text))) return 'inspector-resource-unavailable'
  if (message.includes('Response body is unavailable for redirect responses')) return 'redirect-body-unavailable'
  if (message.includes('Target page, context or browser has been closed')) return 'target-closed'
  return 'unknown'
}
export class ContextualTestBoundary {
  private failed: Failure | null = null
  private requestFailure: RequestFailure | null = null
  private responseFailure: ResponseFailure | null = null
  private endpointFailure: EndpointFailure | null = null
  private readonly tasks = new Map<object, Set<Task>>()
  private readonly responses = new WeakMap<object, Promise<unknown>>()
  private readonly requests = new WeakMap<object, { context: object; task: Task; finish: () => void }>()
  private readonly reservations = new Map<string, Reservation>()
  private readonly testIds: Set<string>
  private readonly counts = { appRequests: 0, storageRequests: 0, tests: 2, reservations: 0, uploads: 0 }

  constructor(readonly plan: RehearsalPlan, readonly deadline: number, private readonly now = Date.now) {
    this.testIds = new Set(plan.retiredTestIds)
    if (!Number.isSafeInteger(deadline) || deadline <= now() || deadline - now() > plan.limits.totalMs) this.reject('deadline')
  }
  private reject(failure: Failure): never {
    this.failed ??= failure
    throw new Error('Private Test rehearsal boundary')
  }
  violate(failure: 'origin' | 'endpoint' | 'context-close'): never {
    return failure === 'endpoint' ? this.endpoint('unspecified') : this.reject(failure)
  }
  /** Only fixed call-site labels and bounded counts; no URL, payload or error. */
  endpoint(reason: EndpointReason, pending: readonly Task[] = []): never {
    if (!this.failed) this.endpointFailure = {
      reason: endpointReasons.includes(reason) ? reason : 'unspecified',
      transports: Math.min(971, pending.filter(task => task.kind === 'transport').length),
      bodies: Math.min(971, pending.filter(task => task.kind === 'body').length),
    }
    return this.reject('endpoint')
  }
  check() {
    if (this.now() >= this.deadline || [...this.tasks.values()].some(set => [...set].some(task => this.now() >= task.end))) this.reject('deadline')
    if (this.failed) this.reject('failed')
  }
  receipt() { return { counts: { ...this.counts }, firstFailure: this.failed, requestFailure: this.requestFailure ? { ...this.requestFailure } : null, responseFailure: this.responseFailure ? { ...this.responseFailure } : null, endpointFailure: this.endpointFailure ? { ...this.endpointFailure } : null, pending: [...this.tasks.values()].reduce((n, set) => n + set.size, 0) } }
  pending(context: object) { return this.tasks.get(context)?.size ?? 0 }
  requestStarted(context: object, request: object) {
    if (this.requests.has(request)) return
    const end = Math.min(this.deadline, this.now() + this.plan.limits.operationMs)
    let finish!: () => void
    const promise = new Promise<void>(resolve => { finish = resolve })
    const task: Task = { end, promise, kind: 'transport' }
    const set = this.tasks.get(context) ?? new Set<Task>(); this.tasks.set(context, set); set.add(task)
    this.requests.set(request, { context, task, finish })
  }
  requestFinished(context: object, request: object, failed = false) {
    const lifetime = this.requests.get(request)
    if (!lifetime || lifetime.context !== context) return
    // Keep the original end for response validation even after transport ends.
    // Body tasks remain separately owned until their original bytes settle.
    if (this.now() >= lifetime.task.end) this.failed ??= 'deadline'
    if (failed) this.failed ??= 'response-body'
    const set = this.tasks.get(context)
    set?.delete(lifetime.task); if (!set?.size) this.tasks.delete(context)
    lifetime.finish()
  }
  canNavigate(context: object, navigationRequest: object) {
    const navigation = this.requests.get(navigationRequest)?.task
    const pending = [...(this.tasks.get(context) ?? [])].filter(task => task !== navigation)
    if (pending.length) this.endpoint('navigation-pending', pending)
    this.check()
  }
  private rejectOrigin(reason: RequestFailure['reason'], u: URL | null, method: string, resource: string): never {
    // Diagnostics only: exact known origins project to fixed labels. No URL,
    // path, query, body, credential, arbitrary method/resource name or hash is
    // retained, and even known font endpoints remain fatal/undispatched.
    const target: RequestFailure['target'] = u?.origin === this.plan.appOrigin ? 'app'
      : u?.origin === this.plan.apiOrigin && u.pathname.startsWith('/storage/v1/') ? 'storage'
        : u?.origin === 'https://fonts.googleapis.com' && ['/css', '/css2'].includes(u.pathname) ? 'google-font-stylesheet'
          : u?.origin === 'https://fonts.gstatic.com' ? 'google-font-file' : 'other'
    this.requestFailure ??= {
      reason, target,
      method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method) ? method as RequestFailure['method'] : 'other',
      resource: ['document', 'stylesheet', 'font', 'script', 'image', 'fetch', 'xhr', 'api'].includes(resource) ? resource as RequestFailure['resource'] : 'other',
    }
    return this.reject('origin')
  }
  admit(value: string, method: string, body?: unknown, resource = 'other') {
    this.check()
    let u: URL; try { u = new URL(value) } catch { return this.rejectOrigin('malformed-url', null, method, resource) }
    const app = u.origin === this.plan.appOrigin
    const storage = u.origin === this.plan.apiOrigin && u.pathname.startsWith('/storage/v1/')
    if (u.protocol !== 'http:' || u.username || u.password || (!app && !storage)) {
      this.rejectOrigin(u.username || u.password ? 'credentials' : u.protocol !== 'http:' ? 'protocol' : 'origin', u, method, resource)
    }
    if (app && (/\/api\/(?:cron|billing|workos)|\/ai-grade|\/ai-grading|\/api\/auth\/(?:signup|forgot-password|reset-password|workos)/.test(u.pathname)
      || (/^\/api\//.test(u.pathname) && !['GET', 'HEAD'].includes(method)
        && !(method === 'POST' && u.pathname === '/api/auth/login') && !/^\/api\/(?:teacher|student)\/tests(?:\/|$)/.test(u.pathname)))) this.endpoint('prohibited-api')
    const key = app ? 'appRequests' : 'storageRequests'
    if (this.counts[key] >= (app ? 950 : 20)) this.reject('request-cap')
    this.counts[key]++
    const row = body && typeof body === 'object' ? body as Record<string, unknown> : null
    if (app && method === 'POST' && u.pathname === '/api/teacher/tests') {
      if (!row || !Object.values(this.plan.classrooms).some(c => c.id === row.classroom_id) || this.counts.tests >= this.plan.limits.tests) this.reject('test-cap')
      this.counts.tests++
    }
    if (app && method === 'POST' && /^\/api\/teacher\/tests\/[0-9a-f-]+\/documents\/upload$/.test(u.pathname)) {
      if (!row || typeof row.document_id !== 'string' || this.reservations.has(row.document_id) || !Number.isSafeInteger(row.byte_size)
        || Number(row.byte_size) <= 0 || Number(row.byte_size) > this.plan.limits.uploadBytes || this.counts.reservations >= this.plan.limits.uploadObjects) this.reject('upload-cap')
      this.counts.reservations++
      this.reservations.set(row.document_id, { testId: u.pathname.split('/')[4], bytes: Number(row.byte_size), url: null, readPath: null, managedId: null, uploaded: false })
    }
    if (storage && !['GET', 'HEAD', 'PUT'].includes(method)) this.reject('storage-method')
    if (storage && ['GET', 'HEAD'].includes(method)) {
      if (u.hash || u.searchParams.size !== 1 || !u.searchParams.has('token') || !u.searchParams.get('token')
        || u.searchParams.get('token')!.length > 4096
        || ![...this.reservations.values()].some(r => r.uploaded && r.readPath === u.pathname)) this.reject('storage-reservation')
    }
    if (storage && method === 'PUT') {
      const reservation = [...this.reservations.values()].find(r => r.url === value)
      if (!reservation || reservation.uploaded) this.reject('storage-reservation')
      const bytes = body instanceof Uint8Array ? body.byteLength : null
      if (!Number.isSafeInteger(bytes) || bytes! < reservation.bytes || bytes! > reservation.bytes + 4096) this.reject('storage-bytes')
      reservation.uploaded = true
    }
  }
  observe(context: object, response: OriginalResponse, request?: { method(): string; postDataJSON(): unknown }, source: 'browser' | 'api' = 'browser') {
    const cached = this.responses.get(response)
    if (cached) return cached
    const end = (request && this.requests.get(request)?.task.end) ?? Math.min(this.deadline, this.now() + this.plan.limits.operationMs)
    let phase: Failure = 'response-body'
    // Start the original response read at headers, but retain ownership through
    // transport completion: Playwright defers acquisition until requestfinished.
    const original = (async () => {
      const headers = response.headers(), mime = headers['content-type'] ?? ''
      if (!/json/i.test(mime)) return undefined
      // Pinned Playwright 1.58's Chromium adapter can refetch an empty inspector
      // body when the provisional Content-Length is truthy. The synchronous
      // headers preserve that same payload (duplicates join, never overwrite).
      // Until an original-only reader supports positive lengths, reject them
      // before body(), including incidental JSON. APIResponse has no CDP path.
      if (source === 'browser') {
        phase = 'response-original-incompatible'
        const lengths = Object.entries(headers).filter(([name]) => name.toLowerCase() === 'content-length')
        if (lengths.length > 1 || (lengths.length === 1 && lengths[0][1] !== '0')) this.reject(phase)
      }
      phase = 'response-body'
      const bytes = await response.body()
      phase = 'response-cap'
      if (bytes.byteLength > this.plan.limits.responseBytes) this.reject(phase)
      phase = 'response-json'
      const value: unknown = JSON.parse(bytes.toString('utf8'))
      phase = 'response-acknowledgement'
      if (response.status() >= 200 && response.status() < 300) this.acknowledge(response, request, value)
      return value
    })()
    const set = this.tasks.get(context) ?? new Set<Task>(); this.tasks.set(context, set)
    const task: Task = { end, promise: Promise.resolve(), kind: 'body' }
    const timer = setTimeout(() => { this.failed ??= 'deadline' }, Math.max(0, end - this.now())); timer.unref?.()
    const guarded = original.catch(error => {
      this.failed ??= phase
      if (!this.responseFailure) {
        let resource: ResponseFailure['resource'] = 'other', status: ResponseFailure['status'] = 'other'
        try {
          const path = new URL(response.url()).pathname, code = response.status()
          resource = path === '/api/auth/login' ? 'login' : path === '/api/auth/me' ? 'session' : /^\/api\/(?:teacher|student)\/tests(?:\/|$)/.test(path) ? 'test-api' : 'other'
          status = code >= 200 && code < 300 ? 'success' : code >= 300 && code < 400 ? 'redirect' : code >= 400 && code < 500 ? 'client-error' : code >= 500 && code < 600 ? 'server-error' : 'other'
        } catch { /* Metadata cannot replace the original latched failure. */ }
        this.responseFailure = { phase, resource, status, cause: phase === 'response-body' ? bodyFailureCause(error) : 'unknown' }
      }
      return undefined
    }).finally(() => {
      // Timer callbacks may be delayed. Retirement cannot erase an expired
      // operation, and finalization must not throw into an event listener.
      if (this.now() >= end) this.failed ??= 'deadline'
      clearTimeout(timer); set.delete(task); if (!set.size) this.tasks.delete(context)
    })
    task.promise = guarded; set.add(task); this.responses.set(response, guarded)
    return guarded
  }
  private acknowledge(response: OriginalResponse, request: { method(): string; postDataJSON(): unknown } | undefined, value: unknown) {
    const u = new URL(response.url()), row = value && typeof value === 'object' ? value as Record<string, unknown> : null
    if (u.pathname === '/api/teacher/tests' && request?.method() === 'POST' && response.status() === 201) {
      const test = row?.test as Record<string, unknown> | undefined
      if (!test || typeof test.id !== 'string' || this.testIds.has(test.id) || !Object.values(this.plan.classrooms).some(c => c.id === test.classroom_id)) this.reject('response-acknowledgement')
      this.testIds.add(test.id)
    }
    if (/^\/api\/teacher\/tests\/[0-9a-f-]+\/documents\/upload$/.test(u.pathname)) {
      const body = request?.postDataJSON() as Record<string, unknown> | undefined
      const reservation = body && typeof body.document_id === 'string' ? this.reservations.get(body.document_id) : undefined
      if (!body || !reservation || reservation.testId !== u.pathname.split('/')[4]) this.reject('response-acknowledgement')
      if (request?.method() === 'POST') {
        if (!row || typeof row.upload_url !== 'string' || typeof row.managed_object_id !== 'string' || row.bucket !== 'test-documents'
          || typeof row.storage_path !== 'string') this.reject('response-acknowledgement')
        const target = new URL(row.upload_url)
        if (target.origin !== this.plan.apiOrigin || target.username || target.password || target.hash
          || target.pathname !== `/storage/v1/object/upload/sign/test-documents/${row.storage_path}`
          || !Object.values(this.plan.classrooms).some(c => row.storage_path === `classrooms/${c.id}/tests/${reservation.testId}/documents/${body.document_id}/${row.managed_object_id}.pdf`)) this.reject('response-acknowledgement')
        reservation.url = row.upload_url; reservation.managedId = row.managed_object_id
        reservation.readPath = `/storage/v1/object/sign/test-documents/${row.storage_path}`
      } else if (request?.method() === 'PATCH') {
        if (!reservation.uploaded || body?.managed_object_id !== reservation.managedId || this.counts.uploads >= this.plan.limits.uploadObjects) this.reject('response-acknowledgement')
        this.counts.uploads++
      }
    }
  }
  private async drain<T>(context: object, operationEnd: number, next: () => T | Promise<T>): Promise<T> {
    while (this.pending(context)) {
      const tasks = [...this.tasks.get(context)!], end = Math.min(this.deadline, operationEnd, ...tasks.map(task => task.end))
      const remaining = end - this.now()
      if (remaining <= 0) this.reject('deadline')
      let timer: ReturnType<typeof setTimeout> | undefined
      try { await Promise.race([Promise.all(tasks.map(task => task.promise)), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { this.failed ??= 'deadline'; reject(new Error('Private Test rehearsal boundary')) }, remaining)
      })]) } finally { if (timer) clearTimeout(timer) }
    }
    if (this.now() >= operationEnd) this.reject('deadline')
    this.check()
    // Invoke in this continuation: returning a resolved settle() promise and
    // awaiting it at the caller adds a host scheduling gap before dispatch.
    return next()
  }
  settle(context: object, operationEnd = this.deadline) {
    return this.drain(context, operationEnd, () => undefined)
  }
  async depart(context: object, operationEnd: number, action: (remainingMs: number) => Promise<unknown>) {
    await this.drain(context, operationEnd, () => action(operationEnd - this.now()))
    await this.settle(context, operationEnd)
    // This removes only the host-side gap. canNavigate still rejects requests
    // that race the native command before interception; never wait in its route.
  }
  async beforeContextClose(context: object, close: () => Promise<void>) {
    let failed = false
    try { await this.settle(context) } catch { failed = true }
    try { await close() } catch { failed = true; this.failed ??= 'context-close' }
    // Event handlers stay installed during disposal. A late response must join
    // the same bounded ownership and can never turn a failed close into success.
    try { await this.settle(context) } catch { failed = true }
    if (failed) this.reject('failed')
  }
}
