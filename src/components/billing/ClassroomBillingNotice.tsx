'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { buttonVariants, PageContent, PageLayout } from '@/ui'
import { fetchBillingSubscription, type BillingSubscriptionStatus } from '@/lib/billing/subscription'
import { BillingAccessNotice } from './BillingAccessNotice'

export function ClassroomBillingNotice() {
  const [status, setStatus] = useState<BillingSubscriptionStatus | null>(null)
  useEffect(() => {
    let request: AbortController | undefined
    async function refresh() {
      request?.abort()
      const controller = new AbortController()
      request = controller
      try {
        const result = await fetchBillingSubscription(controller.signal)
        if (!controller.signal.aborted) setStatus(result)
      } catch {
        if (!controller.signal.aborted) setStatus(null)
      }
    }
    void refresh()
    window.addEventListener('focus', refresh)
    return () => {
      request?.abort()
      window.removeEventListener('focus', refresh)
    }
  }, [])

  if (!status?.accessNotice || status.accessNotice === 'ended' || !status.accessEndsAt) return null
  return (
    <PageLayout density="teacher" width="reading">
      <PageContent>
        <BillingAccessNotice notice={status.accessNotice} accessEndsAt={status.accessEndsAt} trial={status.state === 'trial'}
          action={<Link href="/billing" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>Plans and billing</Link>} />
      </PageContent>
    </PageLayout>
  )
}
