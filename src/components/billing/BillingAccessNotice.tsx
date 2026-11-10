import type { ReactNode } from 'react'
import { billingDate, type BillingAccessNotice as Notice } from '@/lib/billing/subscription'

export function BillingAccessNotice({ notice, accessEndsAt, trial = false, action }: {
  notice: Notice
  accessEndsAt: string
  trial?: boolean
  action?: ReactNode
}) {
  const expired = notice === 'ended'
  const overdue = notice === 'payment_overdue'
  const title = expired ? 'Access ended' : overdue ? 'Payment overdue'
    : notice === 'ending_within_24_hours' ? 'Access ends within 24 hours' : 'Access ends within seven days'
  return (
    <div className="flex flex-col items-start justify-between gap-3 rounded-md border border-warning bg-warning-bg px-4 py-3 text-sm sm:flex-row sm:items-center">
      <div role="status" className="min-w-0 flex-1">
        <p className="font-medium text-text-default">{title}</p>
        <p className="text-text-muted">
          {expired ? 'Access to paid features ended' : trial ? 'Your Pro trial ends' : 'Your paid access ends'}{' '}
          <time dateTime={accessEndsAt}>{billingDate(accessEndsAt, true)}</time>.
          {expired ? ' New paid classroom work and new RepoLight analysis are restricted.' : null}
          {' '}Existing student work remains available.
        </p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
