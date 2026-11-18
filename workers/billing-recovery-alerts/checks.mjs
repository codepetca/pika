const minute = 60_000
export const cadence = '*/10 * * * *'
export const windowMs = 10 * minute
const repeatMs = 60 * minute
const deliveryRetryMs = 25 * minute
export const recoveryWorker = 'pika-billing-recovery'
export const lanes = ['paid', 'trial']

const logWindow = `
  FROM "logs"."workersLogs"
  WHERE timestamp >= $start AND timestamp < $end
    AND attributes['$workers.scriptName'] = $script
`
const errorQuery = `
  SELECT count() AS "value" ${logWindow}
    AND ("level" = 'error' OR (attributes['$workers.outcome'] != 'ok' AND attributes['$workers.outcome'] != ''))
`
const receiptQuery = `
  SELECT attributes['lane'] AS "lane", count() AS "value" ${logWindow}
    AND attributes['event'] = 'pika_billing_recovery'
  GROUP BY "lane"
`

export function recoveryAlertWindow(scheduledTime) {
  const end = Math.floor(scheduledTime / windowMs) * windowMs - 2 * minute
  return { start: end - windowMs, end }
}

function count(value) {
  if (typeof value === 'string' && /^\d+$/.test(value)) value = Number(value)
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid recovery alert count')
  return value
}

export function recoveryErrorStart(window, observedThrough) {
  return Math.max(window.end - repeatMs, observedThrough ?? 0)
}

export function missedRecoveryWindow(window, { observedThrough, latestEnd }) {
  return observedThrough === null
    ? latestEnd !== null && latestEnd < window.end
    : observedThrough < window.start
}

export async function checkRecoveryAlerts(analytics, window, expectedLanes, script = recoveryWorker) {
  const params = {
    start: new Date(window.start).toISOString(),
    end: new Date(window.end).toISOString(),
    script,
  }
  const [errors, receipts] = await Promise.all([
    analytics.query({ query: errorQuery, params: { ...params, start: new Date(window.errorStart ?? window.start).toISOString() } }),
    analytics.query({ query: receiptQuery, params }),
  ])
  if (!Array.isArray(errors.data) || errors.data.length !== 1 || !Array.isArray(receipts.data)) {
    throw new Error('Invalid recovery alert analytics result')
  }
  const errorCount = count(errors.data[0]?.value)
  const observed = new Set()
  for (const row of receipts.data) {
    if (!lanes.includes(row.lane) || observed.has(row.lane) || count(row.value) === 0) {
      throw new Error('Invalid recovery alert lane receipt')
    }
    observed.add(row.lane)
  }
  return { errorCount, missingLanes: expectedLanes.filter(lane => !observed.has(lane)) }
}

export function alertConditions(result) {
  if (result.queryFailed) return ['analytics_unavailable']
  const conditions = result.errorCount > 0 ? ['recovery_errors'] : []
  if (result.coverageGap) conditions.push('monitoring_gap')
  for (const lane of result.missingLanes) conditions.push(`missing_${lane}`)
  return conditions
}

export function nextAlertState(previous, window, result, now, id) {
  const state = previous ?? {
    latestEnd: 0, observedThrough: null, active: [], notified: {}, pending: [], unconfirmedDelivery: false,
  }
  const expired = state.pending.filter(alert => now - alert.createdAt >= deliveryRetryMs)
  state.pending = state.pending.filter(alert => now - alert.createdAt < deliveryRetryMs)
  if (expired.length) state.unconfirmedDelivery = true
  const accepted = result !== null && window.end >= state.latestEnd && (
    result.queryFailed ? window.end > state.latestEnd : window.end > (state.observedThrough ?? 0)
  )
  if (accepted) {
    state.latestEnd = window.end
    if (result.queryFailed) {
      if (!state.active.includes('analytics_unavailable')) state.active.push('analytics_unavailable')
    } else {
      state.observedThrough = window.end
      state.active = alertConditions(result)
    }
    state.notified = Object.fromEntries(Object.entries(state.notified).filter(([condition]) => state.active.includes(condition)))
  }

  // An expired send may have reached Brevo without a response. Let the
  // repeat interval elapse before a persistent condition gets a new key.
  for (const alert of expired) {
    for (const condition of alert.conditions) {
      if (state.active.includes(condition)) state.notified[condition] = state.latestEnd
    }
  }
  const due = accepted ? alertConditions(result).filter(condition => {
    const last = state.notified[condition]
    return (last === undefined || window.end - last >= repeatMs)
      && !state.pending.some(alert => alert.conditions.includes(condition))
  }) : []
  if (state.unconfirmedDelivery && !state.pending.some(alert => alert.conditions.includes('delivery_unconfirmed'))) {
    due.push('delivery_unconfirmed')
  }
  if (due.length) state.pending.push({ id, createdAt: now, window, result, conditions: due })
  return { state, accepted, expired }
}

export function recordAlertDelivery(state) {
  const delivered = state.pending.shift()
  if (delivered.conditions.includes('delivery_unconfirmed')) state.unconfirmedDelivery = false
  for (const condition of delivered.conditions) {
    if (state.active.includes(condition)) state.notified[condition] = state.latestEnd
  }
}
