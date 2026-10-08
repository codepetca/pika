import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { billingUpgradeRequestSchema, billingUpgradeConfirmSchema, billingUpgradeIdSchema,
  publicBillingUpgradeSchema, type PublicBillingUpgrade } from '@/lib/validations/billing-upgrades'
import { UpgradeConfirmationError, UpgradeEligibilityError } from './upgrade-contracts'

export type BillingUpgradeRuntime = {
  startUpgrade(input: { subjectUserId: string; operationId: string; offeringVersionId: string }): Promise<PublicBillingUpgrade | null>
  confirmUpgrade(input: { subjectUserId: string; operationId: string; quoteRevision: number; quoteDigest: string }): Promise<PublicBillingUpgrade | null>
  getUpgrade(input: { subjectUserId: string; operationId: string }): Promise<PublicBillingUpgrade | null>
}

async function readBody(request: NextRequest): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new ApiError(415, 'Expected JSON request')
  const reader = request.body?.getReader()
  if (!reader) throw new ApiError(400, 'Missing request body')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 4096) { await reader.cancel(); throw new ApiError(413, 'Request body is too large') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new ApiError(400, 'Malformed JSON body') }
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
      const input = billingUpgradeRequestSchema.parse(await readBody(request))
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
      const input = billingUpgradeConfirmSchema.parse(await readBody(request))
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
      if (!result) throw new ApiError(404, 'Not found')
      return json(result, operationId)
    }),
  }
}
