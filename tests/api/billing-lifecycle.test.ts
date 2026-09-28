import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ config: vi.fn(), authenticate: vi.fn(), runtime: vi.fn(), startTrial: vi.fn(), getStatus: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireRole: mock.authenticate }))
vi.mock('@/lib/server/billing/purchase-config', () => ({ readBillingPurchaseConfig: mock.config }))
vi.mock('@/lib/server/billing/lifecycle-runtime', () => ({ createBillingLifecycleRuntime: mock.runtime }))
import { GET as status } from '@/app/api/billing/subscription/route'
import { POST as trial } from '@/app/api/billing/trial/route'
import { BillingLifecycleEligibilityError } from '@/lib/server/billing/lifecycle-service'

const subject = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const operationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const origin = 'http://localhost:3000'
const context = { params: Promise.resolve({}) }
const access = { subject_user_id: subject, state: 'trial', plan_key: 'plus', offering_version_id: null,
  classroom_limit: 5, access_ends_at: '2026-10-27T19:00:00Z', renewal_at: null,
  can_start_paid_work: true, retryable: false, revision: 1 }
function request(body: unknown = { operationId }, headers = {}) {
  return new NextRequest(`${origin}/api/billing/trial`, { method: 'POST',
    headers: { origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
}
beforeEach(() => {
  vi.resetAllMocks()
  mock.config.mockReturnValue({ appOrigin: origin })
  mock.authenticate.mockResolvedValue({ id: subject })
  mock.runtime.mockReturnValue(mock)
  mock.startTrial.mockResolvedValue(access)
  mock.getStatus.mockResolvedValue(access)
})
describe('billing lifecycle API boundaries', () => {
  it('hides both endpoints without constructing clients when disabled', async () => {
    mock.config.mockReturnValue(null)
    for (const handler of [status, trial]) expect((await handler(request(), context)).status).toBe(404)
    expect(mock.authenticate).not.toHaveBeenCalled()
    expect(mock.runtime).not.toHaveBeenCalled()
  })
  it.each(['AuthenticationError', 'AuthorizationError'])('rejects %s before database access', async name => {
    mock.authenticate.mockRejectedValue(Object.assign(new Error('Denied'), { name }))
    for (const handler of [status, trial]) expect((await handler(request(), context)).status).toBe(name === 'AuthenticationError' ? 401 : 403)
    expect(mock.authenticate).toHaveBeenCalledWith('teacher')
    expect(mock.runtime).not.toHaveBeenCalled()
  })
  it('uses authenticated identity and exposes public Pro naming without internal account IDs', async () => {
    const response = await trial(request(), context)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mock.startTrial).toHaveBeenCalledWith({ subjectUserId: subject, operationId })
    const result = await response.json()
    expect(result).toMatchObject({ state: 'trial', plan: 'pro', classroomLimit: 5, canStartPaidWork: true })
    expect(result).not.toHaveProperty('subject_user_id')
    expect(result).not.toHaveProperty('plan_key')
  })
  it('reads actual effective state, ignoring payment claims and account IDs in the URL', async () => {
    mock.getStatus.mockResolvedValue({ ...access, state: 'free', plan_key: 'free', classroom_limit: 0, can_start_paid_work: false })
    const response = await status(new NextRequest(`${origin}/api/billing/subscription?paid=true&subjectUserId=${operationId}`), context)
    expect(response.status).toBe(200)
    expect(mock.getStatus).toHaveBeenCalledWith({ subjectUserId: subject })
    expect(await response.json()).toMatchObject({ state: 'free', plan: 'free', classroomLimit: 0, canStartPaidWork: false })
  })
  it.each(['https://attacker.example', 'null', 'http://localhost:3001'])('rejects mutation origin %s', async badOrigin => {
    expect((await trial(request(undefined, { origin: badOrigin }), context)).status).toBe(403)
    expect(mock.runtime).not.toHaveBeenCalled()
  })
  it.each([{ operationId, subjectUserId: subject }, { operationId, now: '2026-01-01T00:00:00Z' }, { operationId, plan: 'max' }, { operationId: 'invalid' }])('rejects client identity, time, plan or malformed operation: %j', async input => {
    expect((await trial(request(input), context)).status).toBe(400)
    expect(mock.runtime).not.toHaveBeenCalled()
  })
  it('bounds actual body bytes before decoding, without trusting content-length', async () => {
    expect((await trial(request({ padding: 'x'.repeat(5000) }), context)).status).toBe(413)
    expect(mock.runtime).not.toHaveBeenCalled()
  })
  it('rejects unsupported content type and malformed JSON', async () => {
    expect((await trial(request(undefined, { 'content-type': 'text/plain' }), context)).status).toBe(415)
    const malformed = new NextRequest(`${origin}/api/billing/trial`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{' })
    expect((await trial(malformed, context)).status).toBe(400)
    expect(mock.runtime).not.toHaveBeenCalled()
  })
  it('maps lifetime eligibility conflict to a safe409', async () => {
    mock.startTrial.mockRejectedValue(new BillingLifecycleEligibilityError())
    expect((await trial(request(), context)).status).toBe(409)
  })
  it('rejects a foreign-account runtime result instead of exposing it', async () => {
    mock.getStatus.mockResolvedValue({ ...access, subject_user_id: operationId })
    expect((await status(new NextRequest(`${origin}/api/billing/subscription`), context)).status).toBe(500)
  })
})
