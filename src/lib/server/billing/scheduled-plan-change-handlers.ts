import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { readBillingJsonBody } from './request-body'

const uuid = z.string().uuid().transform(value => value.toLowerCase())
const reserveInput = z.object({ operationId: uuid, offeringVersionId: uuid }).strict()
const confirmInput = z.object({ operationId: uuid }).strict()
const quote = z.object({
  operation_id: uuid, state: z.enum(['quoted', 'confirmed', 'scheduled', 'applied', 'expired']),
  effective_at: z.string().datetime({ offset: true }), expires_at: z.string().datetime({ offset: true }),
  plan_key: z.literal('plus'), currency: z.enum(['usd', 'cad']), interval: z.enum(['month', 'year']),
  recurring_amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  classroom_limit: z.number().int().positive(), due_now: z.literal(0),
}).strict()

export function createScheduledPlanChangeHandlers(deps: {
  configuration(): { appOrigin: string } | null
  authenticate(): Promise<{ id: string }>
  reserve(subject: string, operation: string, offering: string): Promise<unknown>
  confirm(subject: string, operation: string): Promise<unknown>
}) {
  function handler(action: 'reserve' | 'confirm') {
    const run = withErrorHandler('BillingScheduledPlanChange', async request => {
      const config = deps.configuration()
      if (!config) throw new ApiError(404, 'Not found')
      const user = await deps.authenticate()
      if (request.headers.get('origin') !== config.appOrigin) throw new ApiError(403, 'Invalid request origin')
      const body = await readBillingJsonBody(request)
      const input = action === 'reserve'
        ? { action, ...reserveInput.parse(body) }
        : { action, ...confirmInput.parse(body) }
      const raw = input.action === 'reserve'
        ? await deps.reserve(user.id, input.operationId, input.offeringVersionId)
        : await deps.confirm(user.id, input.operationId)
      if (raw === null) throw new ApiError(404, 'Scheduled change operation not found')
      const result = quote.safeParse(raw)
      if (!result.success || result.data.operation_id !== input.operationId) {
        throw new Error('Billing scheduled change result is unavailable')
      }
      const value = result.data
      return NextResponse.json({
        operationId: value.operation_id, state: value.state, plan: 'pro',
        effectiveAt: value.effective_at, expiresAt: value.expires_at,
        currency: value.currency, interval: value.interval, recurringAmount: value.recurring_amount,
        classroomLimit: value.classroom_limit, dueNow: value.due_now,
      })
    })
    return async (...args: Parameters<typeof run>) => {
      const response = await run(...args)
      response.headers.set('Cache-Control', 'private, no-store')
      return response
    }
  }

  return { reserve: handler('reserve'), confirm: handler('confirm') }
}
