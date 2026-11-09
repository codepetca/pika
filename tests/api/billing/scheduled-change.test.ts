import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'
import { createScheduledPlanChangeHandlers } from '@/lib/server/billing/scheduled-plan-change-handlers'

const subject = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const operationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const offeringVersionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const origin = 'http://localhost:3000'
const context = { params: Promise.resolve({}) }
const rawQuote = {
  operation_id: operationId, state: 'quoted', effective_at: '2026-12-08T18:00:00Z',
  expires_at: '2026-11-08T18:15:00Z', plan_key: 'plus', currency: 'usd',
  interval: 'month', recurring_amount: 1900, classroom_limit: 5, due_now: 0,
}
function request(body: unknown, requestOrigin = origin) {
  return new NextRequest(`${origin}/api/billing/scheduled-change`, {
    method: 'POST', headers: { origin: requestOrigin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
function setup() {
  const deps = {
    configuration: vi.fn<() => { appOrigin: string } | null>(() => ({ appOrigin: origin })),
    authenticate: vi.fn().mockResolvedValue({ id: subject }),
    reserve: vi.fn().mockResolvedValue(rawQuote),
    confirm: vi.fn().mockResolvedValue({ ...rawQuote, state: 'confirmed' }),
  }
  return { deps, handlers: createScheduledPlanChangeHandlers(deps) }
}

describe('scheduled plan change admission', () => {
  it('quotes a new recurring price for the exact renewal with nothing due today', async () => {
    const { deps, handlers } = setup()
    const response = await handlers.reserve(request({ operationId, offeringVersionId }), context)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(deps.reserve).toHaveBeenCalledWith(subject, operationId, offeringVersionId)
    expect(await response.json()).toEqual({
      operationId, state: 'quoted', plan: 'pro', effectiveAt: rawQuote.effective_at,
      expiresAt: rawQuote.expires_at, currency: 'usd', interval: 'month',
      recurringAmount: 1900, classroomLimit: 5, dueNow: 0,
    })
  })

  it('confirms only the owned server quote without asserting provider completion', async () => {
    const { deps, handlers } = setup()
    const response = await handlers.confirm(request({ operationId }), context)
    expect(await response.json()).toMatchObject({ operationId, state: 'confirmed' })
    expect(deps.confirm).toHaveBeenCalledWith(subject, operationId)
    deps.confirm.mockResolvedValue(null)
    expect((await handlers.confirm(request({ operationId }), context)).status).toBe(404)
  })

  it('keeps disabled and cross-origin requests away from the mutation', async () => {
    const { deps, handlers } = setup()
    deps.configuration.mockReturnValueOnce(null)
    expect((await handlers.confirm(request({ operationId }), context)).status).toBe(404)
    expect(deps.authenticate).not.toHaveBeenCalled()
    expect((await handlers.confirm(request({ operationId }, 'https://example.com'), context)).status).toBe(403)
    expect(deps.confirm).not.toHaveBeenCalled()
  })

  it('rejects client-supplied account, timing and price fields', async () => {
    const { deps, handlers } = setup()
    expect((await handlers.reserve(request({ operationId, offeringVersionId, subjectUserId: subject }), context)).status).toBe(400)
    expect((await handlers.confirm(request({ operationId, dueNow: 1, effectiveAt: rawQuote.effective_at }), context)).status).toBe(400)
    expect(deps.reserve).not.toHaveBeenCalled()
    expect(deps.confirm).not.toHaveBeenCalled()
  })
})
