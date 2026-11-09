const origin = 'https://pika.codepet.ca'
const cadence = '*/2 * * * *'
const timeoutMs = 185_000
const maxResponseBytes = 8_192
const secretFormat = /^[A-Za-z0-9_-]{32,256}$/

const lanes = {
  paid: {
    enabled: 'BILLING_PAID_RECOVERY_ENABLED',
    secret: 'BILLING_LIVE_PAYMENT_WORKER_SECRET',
    path: '/api/billing/stripe/live/process',
    required: ['purchases', 'reconciliation', 'closeouts', 'expiry', 'assignmentReleases'],
    processed: ['purchases', 'reconciliation', 'closeouts', 'expiry'],
    optional: ['scheduledInstallations', 'scheduledCancellations'],
  },
  trial: {
    enabled: 'BILLING_TRIAL_RECOVERY_ENABLED',
    secret: 'BILLING_LIVE_TRIAL_WORKER_SECRET',
    path: '/api/billing/trial/process',
    required: ['lifecycle', 'assignmentReleases'],
    processed: ['lifecycle'],
    optional: [],
  },
}
const issueNames = ['failed', 'exceptions', 'attention']
const progressNames = {
  purchases: ['processed'],
  reconciliation: ['processed', 'applied', 'replayed', 'deferred'],
  closeouts: ['processed', 'closed', 'paymentWon', 'deferred'],
  expiry: ['processed'],
  lifecycle: ['processed'],
  assignmentReleases: ['released', 'suppressed', 'superseded', 'noop', 'busy', 'disabled'],
  scheduledInstallations: ['installed', 'expired', 'retry', 'deferred', 'busy', 'lost_claim'],
  scheduledCancellations: ['canceled', 'restored', 'restored_after_cutoff', 'unchanged_after_cutoff', 'completed',
    'retry', 'deferred', 'busy', 'lost_claim'],
}
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const isCount = value => Number.isSafeInteger(value) && value >= 0

async function readReceipt(response) {
  const mediaType = response.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json' || !response.body) {
    await response.body?.cancel().catch(() => undefined)
    return null
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0
  let text = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) return JSON.parse(text + decoder.decode())
      bytes += value.byteLength
      if (bytes > maxResponseBytes) return null
      text += decoder.decode(value, { stream: true })
    }
  } catch {
    return null
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

function summarizeReceipt(receipt, lane) {
  if (!isRecord(receipt)) return null
  const issues = {}
  const counts = {}
  for (const key of lane.required) {
    if (!isRecord(receipt[key])) return null
  }
  for (const key of [...lane.required, ...lane.optional]) {
    if (!Object.hasOwn(receipt, key)) continue
    const section = receipt[key]
    if (!isRecord(section)) return null
    if (lane.processed.includes(key) && !isCount(section.processed) && section.failed !== 1) return null
    for (const name of issueNames) {
      if (!Object.hasOwn(section, name)) continue
      const count = section[name]
      if (!isCount(count)) return null
      if (count > 0) (issues[key] ??= {})[name] = count
    }
    for (const name of progressNames[key]) {
      if (!Object.hasOwn(section, name)) continue
      const count = section[name]
      if (!isCount(count)) return null
      const sectionCounts = counts[key] ??= {}
      sectionCounts[name] = count
    }
  }
  return { issues, counts }
}

async function invokeLane(lane, secret) {
  if (typeof secret !== 'string' || !secretFormat.test(secret)) return { outcome: 'invalid_secret' }
  const startedAt = Date.now()
  const signal = AbortSignal.timeout(timeoutMs)
  try {
    const response = await fetch(origin + lane.path, {
      method: 'POST',
      // Workers supports manual redirects. Treat every 3xx as a failed receipt.
      redirect: 'manual',
      headers: { Authorization: 'Bearer ' + secret, Accept: 'application/json' },
      signal,
    })
    const elapsedMs = () => Date.now() - startedAt
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined)
      return { outcome: 'http_error', status: response.status, elapsedMs: elapsedMs() }
    }
    const summary = summarizeReceipt(await readReceipt(response), lane)
    if (summary === null) return { outcome: signal.aborted ? 'timeout' : 'invalid_receipt', elapsedMs: elapsedMs() }
    return { outcome: Object.keys(summary.issues).length ? 'needs_attention' : 'ok', elapsedMs: elapsedMs(), ...summary }
  } catch {
    return { outcome: signal.aborted ? 'timeout' : 'request_failed', elapsedMs: Date.now() - startedAt }
  }
}

export default {
  async scheduled(controller, env) {
    if (controller.cron !== cadence || !Number.isSafeInteger(controller.scheduledTime)) {
      throw new Error('Unexpected Pika billing recovery trigger')
    }
    const active = Object.entries(lanes).filter(([, lane]) => env[lane.enabled] !== undefined && env[lane.enabled] !== 'false')
    if (active.length === 0) return
    const paidSecret = env[lanes.paid.secret]
    if (env[lanes.paid.enabled] === 'true' && env[lanes.trial.enabled] === 'true'
      && typeof paidSecret === 'string' && paidSecret === env[lanes.trial.secret]) {
      throw new Error('Pika billing recovery credentials must be distinct')
    }
    const delayMs = Math.max(0, Date.now() - controller.scheduledTime)
    const outcomes = await Promise.all(active.map(async ([name, lane]) => {
      const result = env[lane.enabled] === 'true'
        ? await invokeLane(lane, env[lane.secret])
        : { outcome: 'invalid_switch' }
      const event = { event: 'pika_billing_recovery', lane: name, scheduledAt: controller.scheduledTime, delayMs, ...result }
      if (result.outcome === 'ok') console.info(event)
      else console.error(event)
      return result.outcome
    }))
    // The scheduler's outcome should reflect partial failures in a 200 reply.
    if (outcomes.some(outcome => outcome !== 'ok')) throw new Error('Pika billing recovery needs attention')
  },
}
