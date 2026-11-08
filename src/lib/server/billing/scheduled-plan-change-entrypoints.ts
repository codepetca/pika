import { ApiError } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { createTargetBoundFetch } from '@/lib/server/supabase-target'
import { readBillingPurchaseConfig } from './purchase-config'
import { createScheduledPlanChangeHandlers } from './scheduled-plan-change-handlers'

function configuration() {
  if (process.env.BILLING_SCHEDULED_CHANGES_ENABLED !== 'true' || process.env.BILLING_SCHEDULED_RENEWALS_ENABLED !== 'true') return null
  return readBillingPurchaseConfig()
}

function client() {
  const config = configuration()
  if (!config) throw new Error('Billing scheduled change is unavailable')
  return getServiceRoleClient({ fetch: createTargetBoundFetch(config.supabaseOrigin) })
}

function result(response: { data: unknown; error: { code: string; message: string } | null }) {
  if (!response.error) return response.data
  if (['55000', '23505'].includes(response.error.code) && response.error.message.startsWith('billing_scheduled_change')) {
    throw new ApiError(409, 'This scheduled plan change is unavailable. Refresh billing and try again.')
  }
  throw new Error('Billing scheduled change operation failed')
}

export const scheduledPlanChangeHandlers = createScheduledPlanChangeHandlers({
  configuration,
  authenticate: () => requireRole('teacher'),
  async reserve(subject, operation, offering) {
    return result(await client().rpc('billing_reserve_scheduled_plan_change_v1', {
      p_subject_user_id: subject, p_operation_id: operation, p_target_offering_version_id: offering,
    }))
  },
  async confirm(subject, operation) {
    return result(await client().rpc('billing_confirm_scheduled_plan_change_v1', {
      p_subject_user_id: subject, p_operation_id: operation,
    }))
  },
})
