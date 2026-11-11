const minute = 60_000
export const cadence = '*/10 * * * *'
export const windowMs = 10 * minute
export const repeatMs = 60 * minute
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

export async function checkRecoveryAlerts(analytics, window, expectedLanes, script = recoveryWorker) {
  const params = {
    start: new Date(window.start).toISOString(),
    end: new Date(window.end).toISOString(),
    script,
  }
  const [errors, receipts] = await Promise.all([
    analytics.query({ query: errorQuery, params }),
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
  for (const lane of result.missingLanes) conditions.push(`missing_${lane}`)
  return conditions
}

export function nextAlertState(previous, end, conditions) {
  if (previous && end <= previous.end) return null
  const previousNotices = previous?.notified ?? {}
  const notified = {}
  const due = []
  for (const condition of conditions) {
    const last = previousNotices[condition]
    if (last === undefined || end - last >= repeatMs) due.push(condition)
    else notified[condition] = last
  }
  // Analytics failure does not resolve previously observed recovery failures.
  if (conditions.includes('analytics_unavailable')) {
    for (const [condition, last] of Object.entries(previousNotices)) {
      if (condition !== 'analytics_unavailable') notified[condition] = last
    }
  }
  return { state: { end, notified }, due }
}
