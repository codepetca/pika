const origin = 'https://pika.codepet.ca'
const dueCheckUrl = 'https://zhioqbapgfcrronyuidm.supabase.co/rest/v1/rpc/billing_recovery_due_v1'
const cadence = '*/2 * * * *'
const timeoutMs = 185_000
const dueCheckTimeoutMs = 5_000
const maxResponseBytes = 8_192
const secretFormat = /^[A-Za-z0-9_-]{32,256}$/
const uuidFormat = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const lanes = {
  paid: {
    enabled: 'BILLING_PAID_RECOVERY_ENABLED',
    secret: 'BILLING_LIVE_PAYMENT_WORKER_SECRET',
    path: '/api/billing/stripe/live/process',
    required: ['purchases', 'reconciliation', 'closeouts', 'expiry', 'assignmentReleases'],
    processed: ['purchases', 'reconciliation', 'closeouts', 'expiry', 'emailNotices'],
    optional: ['scheduledInstallations', 'scheduledCancellations', 'emailNotices'],
  },
  trial: {
    enabled: 'BILLING_TRIAL_RECOVERY_ENABLED',
    secret: 'BILLING_LIVE_TRIAL_WORKER_SECRET',
    path: '/api/billing/trial/process',
    required: ['lifecycle', 'assignmentReleases'],
    processed: ['lifecycle', 'emailNotices'],
    optional: ['emailNotices'],
  },
}
const issueNames = ['failed', 'exceptions', 'attention']
const progressNames = {
  purchases: ['processed'],
  reconciliation: ['processed', 'applied', 'replayed', 'deferred'],
  closeouts: ['processed', 'closed', 'paymentWon', 'deferred'],
  expiry: ['processed'],
  lifecycle: ['processed'],
  emailNotices: ['processed', 'sent'],
  assignmentReleases: ['released', 'suppressed', 'superseded', 'noop', 'busy', 'disabled'],
  scheduledInstallations: ['installed', 'expired', 'retry', 'deferred', 'busy', 'lost_claim'],
  scheduledCancellations: ['canceled', 'restored', 'restored_after_cutoff', 'unchanged_after_cutoff', 'completed',
    'retry', 'deferred', 'busy', 'lost_claim'],
}
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const isCount = value => Number.isSafeInteger(value) && value >= 0
const laneStatuses = ['idle', 'due', 'unavailable']

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

async function checkDueWork(env, paid, trial) {
  const key = env.BILLING_RECOVERY_SUPABASE_PUBLISHABLE_KEY
  const secret = env.BILLING_RECOVERY_CHECK_SECRET
  if (typeof key !== 'string' || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)
    || typeof secret !== 'string' || !secretFormat.test(secret)
    || secret === env[lanes.paid.secret] || secret === env[lanes.trial.secret]) {
    return { outcome: 'invalid_due_check_credentials' }
  }
  const signal = AbortSignal.timeout(dueCheckTimeoutMs)
  const scope = env.BILLING_RECOVERY_REPOLIGHT_SCOPE
  const teacherId = typeof scope === 'string' && uuidFormat.test(scope) ? scope : null
  try {
    const response = await fetch(dueCheckUrl, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        apikey: key,
        'x-pika-billing-recovery-secret': secret,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        p_paid: paid,
        p_trial: trial,
        p_installation: env.BILLING_LIVE_SCHEDULED_INSTALLATION_ENABLED === 'true',
        p_cancellation: env.BILLING_LIVE_SCHEDULED_CANCELLATION_ENABLED === 'true',
        p_scheduled_closeout: env.BILLING_LIVE_SCHEDULED_CLOSEOUT_ENABLED === 'true',
        p_email: env.BILLING_LIVE_EMAIL_NOTICES_ENABLED === 'true',
        p_repolight: scope === 'full' || teacherId !== null,
        p_repolight_teacher_id: teacherId,
      }),
      signal,
    })
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined)
      return { outcome: 'due_check_http_error', status: response.status }
    }
    const receipt = await readReceipt(response)
    if (!isRecord(receipt) || Object.keys(receipt).length !== 5
      || (paid ? !laneStatuses.includes(receipt.paid) : receipt.paid !== null)
      || (trial ? !laneStatuses.includes(receipt.trial) : receipt.trial !== null)
      || typeof receipt.assignment_releases !== 'boolean' || typeof receipt.email_notices !== 'boolean'
      || typeof receipt.repolight !== 'boolean') {
      return { outcome: signal.aborted ? 'due_check_timeout' : 'invalid_due_check_receipt' }
    }
    return { outcome: 'ok', receipt }
  } catch {
    return { outcome: signal.aborted ? 'due_check_timeout' : 'due_check_failed' }
  }
}

function validateLane(env, lane) {
  if (env[lane.enabled] !== 'true') return 'invalid_switch'
  const secret = env[lane.secret]
  return typeof secret !== 'string' || !secretFormat.test(secret) ? 'invalid_secret' : null
}

function confirmedSharedRecovery(result, work) {
  return Boolean(result?.issues)
    && (!work.assignment_releases || !result.issues.assignmentReleases?.failed)
    && (!work.email_notices || Boolean(result.counts.emailNotices) && !result.issues.emailNotices?.failed)
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
    const errors = Object.fromEntries(active.map(([name, lane]) => [name, validateLane(env, lane)]))
    const paid = errors.paid === null
    const trial = errors.trial === null
    const due = paid || trial ? await checkDueWork(env, paid, trial) : null
    const work = due?.receipt
    const shared = work?.assignment_releases || work?.email_notices || work?.repolight
    const dueLanes = active.filter(([name]) => work?.[name] === 'due').map(([name]) => name)
    const idleLanes = active.filter(([name]) => work?.[name] === 'idle').map(([name]) => name)
    // Both routes drain the shared queues. Prefer the trial lane for shared
    // work alone, and give an idle peer a chance if the first attempt fails.
    if (shared && dueLanes.length === 0 && idleLanes.length > 0) dueLanes.push(idleLanes.pop())
    const invoke = async name => {
      const result = await invokeLane(lanes[name], env[lanes[name].secret])
      if (work.email_notices && result.outcome === 'ok' && !result.counts.emailNotices) {
        return { ...result, outcome: 'shared_recovery_unconfirmed' }
      }
      return result
    }
    const results = Object.fromEntries(await Promise.all(dueLanes.map(async name => [name, await invoke(name)])))
    if (shared && dueLanes.length === 1 && idleLanes.length > 0
      && !confirmedSharedRecovery(results[dueLanes[0]], work)) {
      const fallback = idleLanes.pop()
      results[fallback] = await invoke(fallback)
    }

    const outcomes = active.map(([name]) => {
      const invalid = errors[name]
      let result
      if (invalid) result = { outcome: invalid }
      else if (due.outcome !== 'ok') result = due
      else if (work[name] === 'unavailable') result = { outcome: 'due_check_lane_unavailable' }
      else result = results[name] ?? { outcome: 'idle' }
      const event = { event: 'pika_billing_recovery', lane: name, scheduledAt: controller.scheduledTime, delayMs, ...result }
      if (result.outcome === 'ok' || result.outcome === 'idle') console.info(event)
      else console.error(event)
      return result.outcome
    })
    // The scheduler's outcome should reflect partial failures in a 200 reply.
    if (outcomes.some(outcome => outcome !== 'ok' && outcome !== 'idle')) throw new Error('Pika billing recovery needs attention')
  },
}
