'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { fetchJSON } from '@/lib/request-cache'
import { Button, Card, ConfirmDialog } from '@/ui'
import { ScheduledCancellationStatusSchema, type ScheduledCancellationStatus } from '@/lib/billing/scheduled-cancellation'
import { billingDate, billingOperation } from './billing-client'

const route = '/api/billing/scheduled-change'
const cancellationRoute = `${route}/cancellation`
const uuid = z.string().uuid()
const termsSchema = z.object({ currency: z.enum(['cad', 'usd']), interval: z.enum(['month', 'year']) })
const offerSchema = termsSchema.extend({ offeringVersionId: uuid, plan: z.literal('pro'), unitAmount: z.number().int().positive() })
const quoteSchema = termsSchema.extend({ operationId: uuid, state: z.enum(['quoted', 'confirmed', 'scheduled', 'expired']),
  plan: z.literal('pro'), effectiveAt: z.string().datetime({ offset: true }), expiresAt: z.string().datetime({ offset: true }),
  recurringAmount: z.number().int().positive(), classroomLimit: z.literal(5), dueNow: z.literal(0) })
type Terms = z.infer<typeof termsSchema>
type Action = 'cancel' | 'undo'
const statusCopy: Record<ScheduledCancellationStatus['state'], string> = {
  install_pending: 'Your change to Pro is being scheduled.', scheduled: 'Change to Pro scheduled.',
  cancel_pending: 'Your cancellation is being confirmed.', cancel_scheduled: 'Renewal cancellation scheduled.',
  undo_pending: 'Your renewal is being restored.', undone: 'Renewal restored. Change to Pro scheduled.',
  completed: 'Your paid Max term ended.', attention: 'This change needs attention. Contact support for help.',
}
const pendingStates = new Set(['install_pending', 'cancel_pending', 'undo_pending'])

function post(url: string, body: object) {
  return fetchJSON<unknown>(url, {
    init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  })
}

export function BillingScheduledChangeCard({ userId, eligibleTerms, onChanged }: {
  userId: string; eligibleTerms?: Terms | null; onChanged(): void
}) {
  const [status, setStatus] = useState<ScheduledCancellationStatus | null>()
  const [offer, setOffer] = useState<z.infer<typeof offerSchema>>()
  const [quote, setQuote] = useState<z.infer<typeof quoteSchema>>()
  const [action, setAction] = useState<Action>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const latest = useRef<ScheduledCancellationStatus['state'] | undefined>(undefined)
  const generation = useRef(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const focusStatus = useRef(false)
  const currency = eligibleTerms?.currency
  const interval = eligibleTerms?.interval

  const acceptStatus = useCallback((value: ScheduledCancellationStatus | null) => {
    const previous = latest.current
    latest.current = value?.state
    setStatus(value)
    if (value?.cancellationOperationId) {
      const key = `pika-billing-cancel:${userId}:${value.scheduleOperationId}`
      if (sessionStorage.getItem(key) === value.cancellationOperationId) sessionStorage.removeItem(key)
    }
    if (previous && value?.state !== previous && (!value || !pendingStates.has(value.state))) onChanged()
  }, [onChanged, userId])
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const request = ++generation.current
    try {
      const result = await fetchJSON<unknown>(cancellationRoute, { init: { cache: 'no-store', signal } })
      const value = ScheduledCancellationStatusSchema.nullable().parse(result)
      if (request !== generation.current || signal?.aborted) return
      setError('')
      acceptStatus(value)
    } catch (error) {
      if (request !== generation.current || signal?.aborted) return
      if (error instanceof ApiError && error.statusCode === 404) {
        setError('')
        acceptStatus(null)
      } else setError('Could not check the scheduled change. Try again.')
    }
  }, [acceptStatus])
  useEffect(() => {
    const abort = new AbortController()
    void refresh(abort.signal)
    return () => abort.abort()
  }, [refresh])
  useEffect(() => {
    setOffer(undefined)
    if (!currency || !interval) return
    const abort = new AbortController()
    void fetchJSON<unknown>(route, { init: { cache: 'no-store', signal: abort.signal } }).then(response => {
      const { items } = z.object({ items: z.array(offerSchema).max(4) }).parse(response)
      if (!abort.signal.aborted) setOffer(items.find(item => item.currency === currency && item.interval === interval))
    }).catch(() => { /* A catalog failure leaves existing schedule controls available. */ })
    return () => abort.abort()
  }, [currency, interval])
  const pending = status ? pendingStates.has(status.state) : false
  useEffect(() => {
    if (!pending) return
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let remaining = 12
    async function poll() {
      await refresh(abort.signal)
      if (!abort.signal.aborted && --remaining > 0) timer = setTimeout(poll, 5000)
    }
    timer = setTimeout(poll, 5000)
    return () => { abort.abort(); clearTimeout(timer) }
  }, [pending, refresh])

  useEffect(() => {
    if (quote || action || !focusStatus.current) return
    focusStatus.current = false
    heading.current?.focus()
  }, [quote, action])

  const quoteKey = offer && `pika-billing-schedule:${userId}:${offer.offeringVersionId}`
  async function review() {
    if (!offer || !quoteKey || status !== null) return
    setBusy(true); setError('')
    try {
      const operationId = billingOperation(quoteKey)
      const value = quoteSchema.parse(await post(route, { operationId, offeringVersionId: offer.offeringVersionId }))
      if (value.operationId !== operationId || value.recurringAmount !== offer.unitAmount
        || value.currency !== offer.currency || value.interval !== offer.interval) throw new Error('Quote mismatch')
      if (value.state === 'quoted' && Date.parse(value.expiresAt) > Date.now()) setQuote(value)
      else {
        sessionStorage.removeItem(quoteKey)
        if (value.state === 'quoted' || value.state === 'expired') setError('This quote expired. Review the change again.')
        else await refresh()
      }
    } catch { setError('Could not prepare the change to Pro. Try again.') }
    finally { setBusy(false) }
  }
  async function confirmQuote() {
    if (!quote) return
    if (!quoteKey || status !== null) {
      setQuote(undefined); setError('This quote is no longer available. Check the scheduled change status.'); return
    }
    if (Date.parse(quote.expiresAt) <= Date.now()) {
      sessionStorage.removeItem(quoteKey); setQuote(undefined); setError('This quote expired. Review the change again.'); return
    }
    setBusy(true); setError('')
    try {
      const result = quoteSchema.parse(await post(`${route}/confirm`, { operationId: quote.operationId }))
      if (result.operationId !== quote.operationId || !['confirmed', 'scheduled'].includes(result.state)) throw new Error('Confirmation mismatch')
      sessionStorage.removeItem(quoteKey)
      focusStatus.current = true
      setQuote(undefined)
      acceptStatus({ scheduleOperationId: result.operationId, cancellationOperationId: null,
        state: 'install_pending', effectiveAt: result.effectiveAt, canCancel: false, canUndo: false })
      await refresh()
    } catch { setError('Could not confirm the change to Pro. Try again.') }
    finally { setBusy(false) }
  }
  async function confirmCancellation() {
    if (!status || !action) return
    setBusy(true); setError('')
    try {
      const key = `pika-billing-cancel:${userId}:${status.scheduleOperationId}`
      const operationId = action === 'cancel' ? billingOperation(key) : status.cancellationOperationId
      if (!operationId) throw new Error('Missing cancellation operation')
      const value = ScheduledCancellationStatusSchema.parse(await post(cancellationRoute, { action,
        operationId, scheduleOperationId: status.scheduleOperationId }))
      if (value.scheduleOperationId !== status.scheduleOperationId || value.cancellationOperationId !== operationId) {
        throw new Error('Cancellation mismatch')
      }
      generation.current++
      focusStatus.current = true
      acceptStatus(value)
      setAction(undefined)
    } catch { setError(action === 'cancel' ? 'Could not confirm cancellation. Try again.' : 'Could not restore renewal. Try again.') }
    finally { setBusy(false) }
  }

  if (!status && !(status === null && offer) && !error) return null
  const dateLabel = status?.state === 'completed' ? 'Max access ended'
    : status?.state === 'cancel_scheduled' ? 'Max access ends' : 'Renewal date'
  return <Card>
    <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold">Scheduled plan change</h2>
    {status ? <>
      <p className="mt-2 text-sm" role="status">{statusCopy[status.state]}</p>
      <p className="mt-1 text-sm text-text-muted">{dateLabel} {billingDate(status.effectiveAt)}</p>
      {status.canCancel ? <Button variant="secondary" className="mt-3" disabled={busy} onClick={() => { setError(''); setAction('cancel') }}>Cancel renewal</Button> : null}
      {status.canUndo ? <Button variant="secondary" className="mt-3" disabled={busy} onClick={() => { setError(''); setAction('undo') }}>Undo cancellation</Button> : null}
    </> : status === null && offer ? <Button variant="secondary" className="mt-3" loading={busy && !quote} onClick={() => void review()}>Review change to Pro</Button> : null}
    {(pending || error) && !quote && !action ? <Button variant="secondary" className="mt-3" onClick={() => void refresh()}>Check scheduled status</Button> : null}
    {error && !quote && !action ? <p className="mt-2 text-sm" role="status">{error}</p> : null}
    {quote ? <ConfirmDialog isOpen title="Schedule a change to Pro?"
      description={`Max continues until ${billingDate(quote.effectiveAt)}. Pro renews at ${quote.currency.toUpperCase()} ${(quote.recurringAmount / 100).toFixed(2)} per ${quote.interval === 'year' ? 'year' : 'month'}, plus applicable tax, and includes five active classrooms. No payment is due today.`}
      confirmLabel={busy ? 'Confirming…' : 'Schedule change'} errorMessage={error || undefined}
      isConfirmDisabled={busy} isCancelDisabled={busy} onCancel={() => { setError(''); setQuote(undefined) }} onConfirm={confirmQuote} /> : null}
    {action && status ? <ConfirmDialog isOpen title={action === 'cancel' ? 'Cancel renewal?' : 'Undo cancellation?'}
      description={action === 'cancel' ? `Your paid Max access continues until ${billingDate(status.effectiveAt)}. The scheduled Pro renewal will be canceled.`
        : `Your scheduled change to Pro will resume on ${billingDate(status.effectiveAt)}.`}
      confirmLabel={busy ? 'Confirming…' : action === 'cancel' ? 'Cancel renewal' : 'Restore renewal'} cancelLabel="Go back"
      errorMessage={error || undefined} isConfirmDisabled={busy} isCancelDisabled={busy}
      onCancel={() => { setError(''); setAction(undefined) }} onConfirm={confirmCancellation} /> : null}
  </Card>
}
