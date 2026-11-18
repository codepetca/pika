'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Card, FormField, Select } from '@/ui'
import type { BillingCatalogItem } from '@/lib/server/billing/purchase-handlers'
import { billingUpgradeOperationMissing, publicBillingUpgradeSchema, type PublicBillingUpgrade } from '@/lib/validations/billing-upgrades'

type Operation = { id: string; offeringId: string; reservationRejected?: boolean }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const formatDate = (value: string) => new Intl.DateTimeFormat('en-CA', {
  year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  timeZone: 'America/Toronto', timeZoneName: 'short',
}).format(new Date(value))
const money = (amount: number, currency: string) => `${currency.toUpperCase()} ${(amount / 100).toFixed(2)}`

export function BillingUpgradeCard({ userId, offers, catalog = offers, onActivated }: {
  userId: string; offers: BillingCatalogItem[]; catalog?: BillingCatalogItem[]; onActivated: () => void
}) {
  const key = `pika-billing-upgrade:${userId}`
  const [selected, setSelected] = useState(offers[0]?.offeringVersionId ?? '')
  const [operation, setOperation] = useState<Operation | null>(null)
  const [result, setResult] = useState<PublicBillingUpgrade | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [ready, setReady] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const generation = useRef(0)
  const activated = useRef(false)
  const onActivatedRef = useRef(onActivated)
  onActivatedRef.current = onActivated
  const knownOffers = useRef(catalog)
  knownOffers.current = catalog

  const accept = useCallback(async (response: Response, op: Operation) => {
    if (!response.ok) throw new Error('Upgrade request failed')
    const value = publicBillingUpgradeSchema.parse(await response.json())
    if (value.operationId !== op.id.toLowerCase()) throw new Error('Upgrade operation mismatch')
    const offer = knownOffers.current.find(item => item.offeringVersionId === op.offeringId)
    if (value.quote && (!offer || value.quote.plan !== offer.plan || value.quote.currency !== offer.currency
      || value.quote.nextRecurringAmount !== offer.unitAmount)) throw new Error('Upgrade quote mismatch')
    return value
  }, [])
  const check = useCallback(async (op: Operation) => {
    const request = ++generation.current
    setBusy(true); setMessage('')
    try {
      const response = await fetch(`/api/billing/upgrade/${op.id}`, { cache: 'no-store' })
      if (response.status === 404 && op.reservationRejected) {
        const missing = await response.json()
        if (generation.current !== request) return
        if (missing.error === billingUpgradeOperationMissing) {
          sessionStorage.removeItem(key)
          setOperation(null)
          setResult(null)
          setMessage('This quote could not be started. You can request a new quote.')
          return
        }
        throw new Error('Upgrade status is unavailable')
      }
      const value = await accept(response, op)
      if (generation.current !== request) return
      setResult(value)
      if (value.status === 'active' && !activated.current) {
        activated.current = true; sessionStorage.removeItem(key); onActivatedRef.current()
      }
    } catch {
      if (generation.current === request) setMessage('Could not check this upgrade. Please try again.')
    } finally { if (generation.current === request) setBusy(false) }
  }, [accept, key])
  useEffect(() => {
    setOperation(null); setResult(null); setMessage(''); activated.current = false
    const requests = generation
    let op: Operation | null = null
    try {
      const stored = JSON.parse(sessionStorage.getItem(key) ?? 'null')
      if (stored && typeof stored.id === 'string' && uuid.test(stored.id) && typeof stored.offeringId === 'string'
        && uuid.test(stored.offeringId)) op = {
        id: stored.id, offeringId: stored.offeringId, reservationRejected: stored.reservationRejected === true,
      }
    } catch { /* Treat invalid local state as absent. */ }
    if (op) { setOperation(op); setSelected(op.offeringId); void check(op) }
    setReady(true)
    return () => { requests.current++ }
  }, [key, check])

  useEffect(() => {
    const expiresAt = result?.quote?.expiresAt
    if (!expiresAt) return
    setNow(Date.now())
    const timer = setTimeout(() => setNow(Date.now()), Math.min(2_147_483_647, Math.max(0, Date.parse(expiresAt) - Date.now()) + 1))
    return () => clearTimeout(timer)
  }, [result?.quote?.expiresAt])

  const chosenOffer = offers.find(item => item.offeringVersionId === selected) ?? offers[0]
  async function start() {
    const offeringId = operation?.offeringId ?? chosenOffer?.offeringVersionId
    if (!offeringId) return
    const op = { id: operation?.id ?? crypto.randomUUID(), offeringId }
    const request = ++generation.current
    setBusy(true); setMessage('')
    try {
      sessionStorage.setItem(key, JSON.stringify(op))
      setOperation(op)
      const response = await fetch('/api/billing/upgrade', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operationId: op.id, offeringVersionId: op.offeringId }) })
      if (generation.current !== request) return
      if (response.status === 409) {
        const rejected = { ...op, reservationRejected: true }
        sessionStorage.setItem(key, JSON.stringify(rejected))
        setOperation(rejected)
      }
      const value = await accept(response, op)
      if (generation.current !== request) return
      setResult(value)
      if (value.status === 'active' && !activated.current) { activated.current = true; sessionStorage.removeItem(key); onActivatedRef.current() }
    } catch {
      if (generation.current === request) setMessage('Could not prepare the quote. Retry or check its status.')
    } finally { if (generation.current === request) setBusy(false) }
  }
  async function confirm() {
    if (!operation || !result?.quote || Date.parse(result.quote.expiresAt) <= Date.now()) return
    const request = ++generation.current
    setBusy(true); setMessage('')
    try {
      const value = await accept(await fetch('/api/billing/upgrade/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operationId: operation.id, quoteRevision: result.quote.quoteRevision, quoteDigest: result.quote.quoteDigest }) }), operation)
      if (generation.current !== request) return
      setResult(value)
      if (value.status === 'active' && !activated.current) { activated.current = true; sessionStorage.removeItem(key); onActivatedRef.current() }
    } catch {
      if (generation.current === request) setMessage('Confirmation could not be verified. Check status or retry the same confirmation.')
    } finally { if (generation.current === request) setBusy(false) }
  }
  function reset() {
    sessionStorage.removeItem(key); setOperation(null); setResult(null); setMessage(''); activated.current = false
  }
  const quote = result?.quote
  const offer = operation ? catalog.find(item => item.offeringVersionId === operation.offeringId) : chosenOffer
  const choices = operation ? (offer ? [offer] : []) : offers
  if (!choices.length && !operation && !message) return null
  return <Card><h2 className="text-lg font-semibold">Upgrade your plan</h2>
    {choices.length ? <div className="mt-3"><FormField label="Upgrade to"><Select value={offer?.offeringVersionId ?? ''} disabled={!ready || busy || !!operation}
      onChange={event => setSelected(event.target.value)} options={choices.map(item => ({ value: item.offeringVersionId,
        label: `${item.name} · ${item.currency.toUpperCase()} ${(item.unitAmount / 100).toFixed(2)} / ${item.interval === 'year' ? 'year' : 'month'}` }))} /></FormField></div> : null}
    {!result && (operation || chosenOffer) && !busy ? <Button className="mt-4" disabled={!ready || operation?.reservationRejected} onClick={() => void start()}>{operation ? 'Retry quote' : 'Review upgrade'}</Button> : null}
    {quote ? <div className="mt-4 space-y-1 text-sm">
      <p>Remaining charge for {offer?.name ?? quote.plan}: {money(quote.remainingChargeAmount, quote.currency)}</p>
      <p>Unused credit: −{money(-quote.unusedCreditAmount, quote.currency)}</p>
      <p className="font-semibold">Amount due now: {money(quote.amountDue, quote.currency)}</p>
      <p>Next renewal: {money(quote.nextRecurringAmount, quote.currency)} / {offer?.interval === 'year' ? 'year' : 'month'} on {formatDate(quote.nextRenewalAt)}</p>
      <p>Quote expires {formatDate(quote.expiresAt)}</p>
      {Date.parse(quote.expiresAt) <= now ? <p>Quote expired. Check status to continue.</p> : null}
      <p className="text-text-muted">This sandbox quote includes no tax or discounts.</p>
      <Button className="mt-3" disabled={busy || Date.parse(quote.expiresAt) <= now} onClick={() => void confirm()}>Confirm upgrade and pay {money(quote.amountDue, quote.currency)}</Button>
    </div> : null}
    {result && result.status !== 'quoted' ? <p className="mt-3 text-sm" role="status">{result.status === 'active' ? 'Your upgrade is active.' : result.status === 'attention' ? 'This upgrade needs attention. Please contact support.' : result.status === 'expired' ? 'This quote has expired.' : 'Your upgrade is being checked. It is not active yet.'}</p> : null}
    {operation && result?.status !== 'active' ? <Button variant="secondary" className="mt-3" disabled={busy} onClick={() => void check(operation)}>Check status</Button> : null}
    {result?.status === 'expired' ? <Button variant="secondary" className="mt-3" disabled={busy} onClick={reset}>Start a new quote</Button> : null}
    {busy ? <p className="mt-3 text-sm" role="status">Checking upgrade…</p> : null}
    {message ? <p className="mt-3 text-sm" role="status">{message}</p> : null}
  </Card>
}
