'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Card, FormField, PageState, Select } from '@/ui'
import { BillingSubscriptionStatusSchema, type BillingSubscriptionStatus } from '@/lib/billing/subscription'
import { BillingUpgradeCard } from './BillingUpgradeCard'
import { BillingScheduledChangeCard } from './BillingScheduledChangeCard'
import { billingDate as date, billingOperation as operation } from './billing-client'
import type { BillingCatalogItem, BillingPurchaseStatus } from '@/lib/server/billing/purchase-handlers'

type LoadState = 'loading' | 'ready' | 'unavailable' | 'error'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const tierOrder = { free: 0, basic: 1, pro: 2, max: 3 }
const planNames = { free: 'Free', basic: 'Basic', pro: 'Pro', max: 'Max' }
const labels: Record<BillingSubscriptionStatus['state'], string> = {
  free: 'Free', trial: 'Pro trial', paid: 'Paid subscription', renewal_grace: 'Payment overdue',
  synchronization_pending: 'Synchronizing', unmanaged: 'Plan managed separately',
}
async function read(response: Response) {
  if (!response.ok) throw Object.assign(new Error('Request failed'), { status: response.status })
  return response.json()
}

export function BillingPage({ userId, billingAvailable = true, purchaseAvailable = true, portalAvailable = false,
  portalCancellationAvailable = false, upgradesAvailable = false, scheduledBillingAvailable = false }: {
  userId: string
  billingAvailable?: boolean
  purchaseAvailable?: boolean
  portalAvailable?: boolean
  portalCancellationAvailable?: boolean
  upgradesAvailable?: boolean
  scheduledBillingAvailable?: boolean
}) {
  const [state, setState] = useState<LoadState>(billingAvailable ? 'loading' : 'unavailable')
  const [subscription, setSubscription] = useState<BillingSubscriptionStatus | null>(null)
  const [catalog, setCatalog] = useState<BillingCatalogItem[]>([])
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [purchase, setPurchase] = useState<BillingPurchaseStatus | null>(null)
  const [returnId, setReturnId] = useState('')
  const [stripeReturn, setStripeReturn] = useState<{ id: string; result: string | null } | null>(null)
  const generation = useRef(0)
  const purchaseGeneration = useRef(0)
  const actionGeneration = useRef(0)
  const load = useCallback(async (refresh = false) => {
    const request = ++generation.current
    if (!refresh) setState('loading')
    try {
      const [status, offers] = await Promise.all([
        fetch('/api/billing/subscription', { cache: 'no-store' }).then(read),
        purchaseAvailable ? fetch('/api/billing/catalog', { cache: 'no-store' }).then(read) : null,
      ])
      if (request !== generation.current) return
      const verified = BillingSubscriptionStatusSchema.parse(status)
      setSubscription(verified)
      if (purchaseAvailable && verified.options?.pendingCheckoutId) setReturnId(verified.options.pendingCheckoutId)
      const items: BillingCatalogItem[] = purchaseAvailable ? offers.items : []
      setCatalog(items)
      setSelected(current => items.some(item => item.offeringVersionId === current) ? current : items[0]?.offeringVersionId ?? '')
      setState('ready')
    } catch (error) {
      if (request !== generation.current) return
      setState((error as { status?: number }).status === 404 ? 'unavailable' : 'error')
    }
  }, [purchaseAvailable])
  const refreshSubscription = useCallback(() => { void load(true) }, [load])
  useEffect(() => {
    if (!billingAvailable) return
    const params = new URLSearchParams(window.location.search)
    const checkout = params.get('checkout')
    if (purchaseAvailable && checkout && uuid.test(checkout)) {
      const id = checkout.toLowerCase()
      setReturnId(id)
      setStripeReturn({ id, result: params.get('result') })
    }
    void load()
    return () => { generation.current++; actionGeneration.current++ }
  }, [billingAvailable, load, purchaseAvailable])
  const checkPurchase = useCallback(async (id: string) => {
    const request = ++purchaseGeneration.current
    try {
      const result: BillingPurchaseStatus = await fetch(`/api/billing/checkout/${id}`, { cache: 'no-store' }).then(read)
      if (request !== purchaseGeneration.current) return 'stale'
      if (result.attemptId !== id) throw new Error('Checkout attempt mismatch')
      setPurchase(result)
      if (result.status === 'expired' || result.status === 'active') {
        const attemptKey = `pika-billing-attempt:${userId}:${id}`
        const offering = sessionStorage.getItem(attemptKey)
        if (offering) {
          const operationKey = `pika-billing-checkout:${userId}:${offering}`
          if (sessionStorage.getItem(operationKey) === id) sessionStorage.removeItem(operationKey)
        }
        sessionStorage.removeItem(attemptKey)
        void load(true)
      }
      return result.status
    } catch {
      if (request !== purchaseGeneration.current) return 'stale'
      setMessage('Could not check your checkout. Please try again.')
      return 'error'
    }
  }, [load, userId])
  const successReturn = stripeReturn?.id === returnId && stripeReturn.result === 'success'
  useEffect(() => {
    if (!purchaseAvailable || !returnId) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    let remaining = 12
    async function poll() {
      const status = await checkPurchase(returnId)
      const waiting = ['pending', 'payment_pending', 'synchronizing'].includes(status)
        || (status === 'checkout_open' && successReturn)
      if (active && waiting && remaining-- > 0) timer = setTimeout(poll, 5000)
    }
    void poll()
    return () => { active = false; purchaseGeneration.current++; clearTimeout(timer) }
  }, [returnId, checkPurchase, successReturn, purchaseAvailable])
  async function startTrial() {
    const request = ++actionGeneration.current
    setBusy(true); setMessage('')
    try {
      const response = await fetch('/api/billing/trial', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operationId: operation(`pika-billing-trial:${userId}`) }) })
      const status = BillingSubscriptionStatusSchema.parse(await read(response))
      if (request !== actionGeneration.current) return
      setSubscription(status)
      setMessage(status.state === 'trial' ? 'Your Pro trial is active.' : 'Your plan status has been updated.')
      void load(true)
    } catch (error) {
      if (request !== actionGeneration.current) return
      const status = (error as { status?: number }).status
      if (status === 409 || status === 404) {
        setMessage('This account cannot start a trial right now.')
        void load(true)
      } else {
        setMessage('Could not start the trial. Please try again.')
      }
    } finally { if (request === actionGeneration.current) setBusy(false) }
  }
  async function checkout() {
    if (!selected) return
    const request = ++actionGeneration.current
    setBusy(true); setMessage('')
    try {
      const operationId = operation(`pika-billing-checkout:${userId}:${selected}`)
      // Save the reverse mapping before the request in case the response is lost.
      sessionStorage.setItem(`pika-billing-attempt:${userId}:${operationId}`, selected)
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offeringVersionId: selected, operationId }),
      })
      const result: BillingPurchaseStatus = await read(response)
      if (request !== actionGeneration.current) return
      if (result.attemptId !== operationId) throw new Error('Checkout attempt mismatch')
      setPurchase(result)
      setReturnId(result.attemptId)
      if (result.checkoutUrl) window.location.assign(result.checkoutUrl)
    } catch (error) {
      if (request !== actionGeneration.current) return
      setMessage((error as { status?: number }).status === 409 ? 'This plan cannot be purchased from your current account state.' : 'Could not start checkout. Please try again.')
    } finally { if (request === actionGeneration.current) setBusy(false) }
  }
  async function openPortal() {
    const request = ++actionGeneration.current
    setBusy(true)
    setMessage('')
    try {
      const { url } = await fetch('/api/billing/portal', { method: 'POST' }).then(read)
      const destination = new URL(url)
      if (destination.protocol !== 'https:' || destination.hostname !== 'billing.stripe.com'
        || destination.username || destination.password || destination.port) throw new Error('Invalid portal destination')
      if (request === actionGeneration.current) window.location.assign(destination.href)
    } catch {
      if (request === actionGeneration.current) setMessage('Could not open billing management. Please try again.')
    } finally {
      if (request === actionGeneration.current) setBusy(false)
    }
  }
  const offer = catalog.find(item => item.offeringVersionId === selected)
  const currentPurchase = purchase?.attemptId === returnId ? purchase : null
  const terms = subscription?.options?.paidTerms
  const upgradeOffers = upgradesAvailable && terms?.upgradeAvailable && subscription
    ? catalog.filter(item => tierOrder[item.plan] > tierOrder[subscription.plan]
      && item.currency === terms.currency && item.interval === terms.interval)
    : []
  return <div className="mx-auto max-w-3xl space-y-5 py-5">
    <h1 className="text-2xl font-semibold">Plans and billing</h1>
    {state === 'loading' ? <PageState kind="loading" title="Loading billing" /> : null}
    {state === 'unavailable' ? <PageState kind="empty" title="Billing is unavailable" description="Plans and billing are not available right now." /> : null}
    {state === 'error' ? <PageState kind="error" title="Could not load billing" action={<Button onClick={() => void load()}>Try again</Button>} /> : null}
    {state === 'ready' && subscription ? <>
      <Card><h2 className="text-lg font-semibold">Your plan</h2>
        <p className="mt-2 font-medium">{labels[subscription.state]}{['paid', 'renewal_grace', 'unmanaged'].includes(subscription.state) ? ` · ${planNames[subscription.plan]}` : ''}</p>
        <p className="mt-1 text-sm text-text-muted">{subscription.classroomLimit} active classrooms</p>
        {subscription.renewalAt && subscription.state === 'paid' ? <p className="mt-1 text-sm">Renews on {date(subscription.renewalAt)}</p> : null}
        {subscription.accessEndsAt ? <p className="mt-1 text-sm">Access ends {date(subscription.accessEndsAt)}</p> : null}
        {terms ? <p className="mt-1 text-sm text-text-muted">
          {terms.currency.toUpperCase()} {(terms.unitAmount / 100).toFixed(2)} / {terms.interval === 'year' ? 'year' : 'month'}
        </p> : null}
        {purchaseAvailable && portalAvailable && subscription.options?.hasBillingCustomer
          ? <Button variant="secondary" className="mt-3" onClick={() => void openPortal()} disabled={busy}>
              {portalCancellationAvailable ? 'Manage billing' : 'Invoices and payment method'}
            </Button>
          : null}
        {subscription.state === 'synchronization_pending' ? <p className="mt-2 text-sm">Your plan is synchronizing. Check again shortly.</p> : null}
      </Card>
      {scheduledBillingAvailable && subscription.options?.hasBillingCustomer ? <BillingScheduledChangeCard userId={userId}
        eligibleTerms={subscription.state === 'paid' && subscription.plan === 'max' && subscription.renewalAt ? terms : null}
        onChanged={refreshSubscription} /> : null}
      {subscription.options?.trialAvailable ? <Card><h2 className="text-lg font-semibold">Try Pro</h2>
        <p className="mt-1 text-sm text-text-muted">Start a 30-day Pro trial without a card or automatic charge. One trial is available per teacher.</p>
        <Button className="mt-4" onClick={() => void startTrial()} disabled={busy}>Start 30-day Pro trial</Button>
      </Card> : null}
      {purchaseAvailable && subscription.options?.checkoutAvailable && catalog.length > 0 ? <Card><h2 className="text-lg font-semibold">Choose a paid plan</h2>
        <div className="mt-3"><FormField label="Plan, currency and billing interval"><Select disabled={busy} value={selected} onChange={event => setSelected(event.target.value)} options={catalog.map(item => ({ value: item.offeringVersionId, label: `${item.name} · ${item.currency.toUpperCase()} ${(item.unitAmount / 100).toFixed(2)} / ${item.interval === 'year' ? 'year' : 'month'}` }))} /></FormField></div>
        {offer ? <p className="mt-2 text-sm text-text-muted">{offer.classroomLimit} active classrooms. {offer.interval === 'year' ? 'Full annual amount charged upfront. ' : ''}Prices exclude applicable tax.</p> : null}
        <Button className="mt-4" onClick={() => void checkout()} disabled={busy || !selected}>Continue to checkout</Button>
      </Card> : null}
      {purchaseAvailable && upgradesAvailable
        ? <BillingUpgradeCard userId={userId} offers={upgradeOffers} catalog={catalog} onActivated={() => void load(true)} />
        : null}
      {purchaseAvailable && returnId ? <Card><h2 className="text-lg font-semibold">Checkout status</h2>
        <p className="mt-2 text-sm" role="status">{currentPurchase?.status === 'active' ? 'Payment and plan access confirmed.' : currentPurchase?.status === 'attention' ? 'Checkout needs attention. Please contact support.' : currentPurchase?.status === 'expired' ? 'Checkout expired.' : currentPurchase?.status === 'checkout_open' && !successReturn ? 'Checkout is ready to continue.' : 'Payment or plan access is being checked.'}</p>
        {currentPurchase?.status === 'checkout_open' && currentPurchase.checkoutUrl && !successReturn
          ? <Button className="mt-3 mr-2" onClick={() => window.location.assign(currentPurchase.checkoutUrl!)}>Resume checkout</Button>
          : null}
        {currentPurchase?.status !== 'active' ? <Button variant="secondary" className="mt-3" onClick={() => void checkPurchase(returnId)}>Check status</Button> : null}
      </Card> : null}
      {message ? <p role="status" className="text-sm text-text-default">{message}</p> : null}
    </> : null}
  </div>
}
