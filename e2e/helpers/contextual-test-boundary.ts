/** Browser-only portion of the existing finite rehearsal boundary. Import-safe.
 * Original Response bytes, never a browser-evaluated or replayed substitute.
 */
import type { RehearsalPlan } from './contextual-test-rehearsal'

type Failure = 'deadline' | 'failed' | 'origin' | 'endpoint' | 'request-cap' | 'test-cap' | 'upload-cap'
  | 'storage-method' | 'storage-reservation' | 'storage-bytes' | 'response-body' | 'response-cap'
  | 'response-json' | 'response-acknowledgement' | 'context-close'
type OriginalResponse = { url(): string; status(): number; headers(): Record<string, string>; body(): Promise<Buffer> }
type Reservation = { testId: string; bytes: number; url: string | null; managedId: string | null; uploaded: boolean }
type Task = { promise: Promise<unknown>; end: number }
export class ContextualTestBoundary {
  private failed: Failure | null = null
  private readonly tasks = new Map<object, Set<Task>>()
  private readonly responses = new WeakMap<object, Promise<unknown>>()
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
  violate(failure: 'origin' | 'endpoint' | 'context-close'): never { return this.reject(failure) }
  check() {
    if (this.now() >= this.deadline || [...this.tasks.values()].some(set => [...set].some(task => this.now() >= task.end))) this.reject('deadline')
    if (this.failed) this.reject('failed')
  }
  receipt() { return { counts: { ...this.counts }, firstFailure: this.failed, pending: [...this.tasks.values()].reduce((n, set) => n + set.size, 0) } }
  pending(context: object) { return this.tasks.get(context)?.size ?? 0 }
  admit(value: string, method: string, body?: unknown) {
    this.check()
    let u: URL; try { u = new URL(value) } catch { return this.reject('origin') }
    const app = u.origin === this.plan.appOrigin
    const storage = u.origin === this.plan.apiOrigin && u.pathname.startsWith('/storage/v1/')
    if (u.protocol !== 'http:' || u.username || u.password || (!app && !storage)) this.reject('origin')
    if (app && (/\/api\/(?:cron|billing|workos)|\/ai-grade|\/ai-grading|\/api\/auth\/(?:signup|forgot-password|reset-password|workos)/.test(u.pathname)
      || (/^\/api\//.test(u.pathname) && !['GET', 'HEAD'].includes(method)
        && !(method === 'POST' && u.pathname === '/api/auth/login') && !/^\/api\/(?:teacher|student)\/tests(?:\/|$)/.test(u.pathname)))) this.reject('endpoint')
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
      this.reservations.set(row.document_id, { testId: u.pathname.split('/')[4], bytes: Number(row.byte_size), url: null, managedId: null, uploaded: false })
    }
    if (storage && !['GET', 'HEAD', 'PUT'].includes(method)) this.reject('storage-method')
    if (storage && method === 'PUT') {
      const reservation = [...this.reservations.values()].find(r => r.url === value)
      if (!reservation || reservation.uploaded) this.reject('storage-reservation')
      const bytes = body instanceof Uint8Array ? body.byteLength : null
      if (!Number.isSafeInteger(bytes) || bytes! < reservation.bytes || bytes! > reservation.bytes + 4096) this.reject('storage-bytes')
      reservation.uploaded = true
    }
  }
  observe(context: object, response: OriginalResponse, request?: { method(): string; postDataJSON(): unknown }) {
    const cached = this.responses.get(response)
    if (cached) return cached
    const end = Math.min(this.deadline, this.now() + this.plan.limits.operationMs)
    let phase: Failure = 'response-body'
    // The async body starts synchronously: response.body() is called on the
    // original Response before any await, queue, navigation or collection hook.
    const original = (async () => {
      const mime = response.headers()['content-type'] ?? ''
      if (!/json/i.test(mime)) return undefined
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
    const task: Task = { end, promise: Promise.resolve() }
    const timer = setTimeout(() => { this.failed ??= 'deadline' }, Math.max(0, end - this.now())); timer.unref?.()
    const guarded = original.catch(() => { this.failed ??= phase; return undefined }).finally(() => {
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
      if (!reservation || reservation.testId !== u.pathname.split('/')[4]) this.reject('response-acknowledgement')
      if (request?.method() === 'POST') {
        if (!row || typeof row.upload_url !== 'string' || typeof row.managed_object_id !== 'string') this.reject('response-acknowledgement')
        const target = new URL(row.upload_url)
        if (target.origin !== this.plan.apiOrigin || !target.pathname.startsWith('/storage/v1/') || target.username || target.password) this.reject('response-acknowledgement')
        reservation.url = row.upload_url; reservation.managedId = row.managed_object_id
      } else if (request?.method() === 'PATCH') {
        if (!reservation.uploaded || body?.managed_object_id !== reservation.managedId || this.counts.uploads >= this.plan.limits.uploadObjects) this.reject('response-acknowledgement')
        this.counts.uploads++
      }
    }
  }
  async settle(context: object) {
    while (this.pending(context)) {
      const tasks = [...this.tasks.get(context)!], end = Math.min(this.deadline, ...tasks.map(task => task.end))
      const remaining = end - this.now()
      if (remaining <= 0) this.reject('deadline')
      let timer: ReturnType<typeof setTimeout> | undefined
      try { await Promise.race([Promise.all(tasks.map(task => task.promise)), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { this.failed ??= 'deadline'; reject(new Error('Private Test rehearsal boundary')) }, remaining)
      })]) } finally { if (timer) clearTimeout(timer) }
    }
    this.check()
  }
  async beforeContextClose(context: object, close: () => Promise<void>) {
    let failed = false
    try { await this.settle(context) } catch { failed = true }
    try { await close() } catch { failed = true; this.failed ??= 'context-close' }
    if (failed) this.reject('failed')
  }
}
