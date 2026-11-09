import { NextResponse } from 'next/server'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { billingUpgradeRequestSchema, billingUpgradeConfirmSchema, billingUpgradeIdSchema,
  billingUpgradeOperationMissing, publicBillingUpgradeSchema, type PublicBillingUpgrade } from '@/lib/validations/billing-upgrades'
import { UpgradeConfirmationError, UpgradeEligibilityError } from './upgrade-contracts'
import { readBillingJsonBody } from './request-body'

export type BillingUpgradeRuntime = {
  startUpgrade(input: { subjectUserId: string; operationId: string; offeringVersionId: string }): Promise<PublicBillingUpgrade | null>
  confirmUpgrade(input: { subjectUserId: string; operationId: string; quoteRevision: number; quoteDigest: string }): Promise<PublicBillingUpgrade | null>
  getUpgrade(input: { subjectUserId: string; operationId: string }): Promise<PublicBillingUpgrade | null>
}

export function createBillingUpgradeHandlers(deps: {
  configuration(): { appOrigin: string } | null
  authenticate(): Promise<{ id: string }>
  loadRuntime(): Promise<BillingUpgradeRuntime>
}) {
  function configuration() {
    const config = deps.configuration()
    if (!config) throw new ApiError(404, 'Not found')
    return config
  }
  function json(value: unknown, operationId: string) {
    const parsed = publicBillingUpgradeSchema.safeParse(value)
    if (!parsed.success || parsed.data.operationId !== operationId) throw new Error('Billing upgrade response is invalid')
    return NextResponse.json(parsed.data)
  }
  // Apply privacy headers to failures too, after the shared error mapper runs.
  function handler(name: string, callback: Parameters<typeof withErrorHandler>[1]) {
    const wrapped = withErrorHandler(name, callback)
    return async (...args: Parameters<typeof wrapped>) => {
      const response = await wrapped(...args)
      response.headers.set('Cache-Control', 'private, no-store')
      return response
    }
  }
  return {
    start: handler('BillingUpgradeStart', async request => {
      const config = configuration()
      const user = await deps.authenticate()
      if (request.headers.get('origin') !== config.appOrigin) throw new ApiError(403, 'Invalid request origin')
      const input = billingUpgradeRequestSchema.parse(await readBillingJsonBody(request))
      const runtime = await deps.loadRuntime()
      try {
        const result = await runtime.startUpgrade({ ...input, subjectUserId: user.id })
        if (!result) throw new ApiError(404, 'Not found')
        return json(result, input.operationId)
      } catch (error) {
        if (error instanceof UpgradeEligibilityError || error instanceof UpgradeConfirmationError) throw new ApiError(409, error.message)
        throw error
      }
    }),
    confirm: handler('BillingUpgradeConfirm', async request => {
      const config = configuration()
      const user = await deps.authenticate()
      if (request.headers.get('origin') !== config.appOrigin) throw new ApiError(403, 'Invalid request origin')
      const input = billingUpgradeConfirmSchema.parse(await readBillingJsonBody(request))
      const runtime = await deps.loadRuntime()
      try {
        const result = await runtime.confirmUpgrade({ ...input, subjectUserId: user.id })
        if (!result) throw new ApiError(404, 'Not found')
        return json(result, input.operationId)
      } catch (error) {
        if (error instanceof UpgradeEligibilityError || error instanceof UpgradeConfirmationError) throw new ApiError(409, error.message)
        throw error
      }
    }),
    status: handler('BillingUpgradeStatus', async (_request, context) => {
      configuration()
      const user = await deps.authenticate()
      const operationId = billingUpgradeIdSchema.parse((await context.params).id)
      const runtime = await deps.loadRuntime()
      const result = await runtime.getUpgrade({ subjectUserId: user.id, operationId })
      if (!result) throw new ApiError(404, billingUpgradeOperationMissing)
      return json(result, operationId)
    }),
  }
}
