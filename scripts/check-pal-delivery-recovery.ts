import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { createClient } from '@supabase/supabase-js'
import { parse } from 'dotenv'

import {
  buildDailyLogWeekConfiguredEvent,
  palPeriodKeyForInstant,
} from '@/lib/server/pal-events'
import {
  attemptImmediatePalEventDelivery,
  deliverPalOutboxBatch,
} from '@/lib/server/pal-outbox'
import { palTermCalendarForPeriodStart } from '@/lib/server/pal-term-calendar'
import type { Database } from '@/types/database'

function requireLocalSupabase() {
  const status = parse(execFileSync(
    'supabase',
    ['status', '-o', 'env'],
    { cwd: process.cwd(), encoding: 'utf8' },
  ))
  const apiUrl = status.API_URL
  const serviceRoleKey = status.SERVICE_ROLE_KEY
  if (!apiUrl || !serviceRoleKey) {
    throw new Error('Local Supabase API URL or service-role key is unavailable')
  }
  const url = new URL(apiUrl)
  if (
    url.protocol !== 'http:'
    || (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')
  ) {
    throw new Error('Pal recovery smoke test refuses non-loopback Supabase targets')
  }
  return { apiUrl: url.origin, serviceRoleKey }
}

function localDatabaseContainer(): string {
  const name = execFileSync(
    'docker',
    ['ps', '--filter', 'name=^supabase_db_pika$', '--format', '{{.Names}}'],
    { encoding: 'utf8' },
  ).trim()
  if (name !== 'supabase_db_pika') {
    throw new Error('Expected the local supabase_db_pika container')
  }
  return name
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

async function main(): Promise<void> {
  const { apiUrl, serviceRoleKey } = requireLocalSupabase()
  const databaseContainer = localDatabaseContainer()
  const supabase = createClient<Database>(apiUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const fixtureId = randomUUID()
  const studentId = randomUUID()
  const email = `pal-recovery-${fixtureId}@example.invalid`
  const integrationSecret = 'pal-recovery-integration-secret-32-characters'
  const pseudonymSecret = 'pal-recovery-pseudonym-secret-32-characters-long'
  const occurredAt = new Date()
  const periodStart = palPeriodKeyForInstant(occurredAt).replace(/^pika-week-/, '')
  const periodKey = `pika-week-${periodStart}`
  const event = buildDailyLogWeekConfiguredEvent({
    learnerId: studentId,
    occurredAt,
    periodKey,
    configVersion: 1,
    periodStatus: 'open',
    eligibleDays: 3,
    termCalendar: palTermCalendarForPeriodStart(periodStart),
    pseudonymSecret,
  })
  let fixtureCreated = false
  let palAvailable = false
  const receivedKeys: string[] = []
  const receivedOccurredAts: string[] = []
  const server = createServer((request, response) => {
    if (
      request.method !== 'POST'
      || request.url !== '/api/v1/events'
      || request.headers.authorization !== `Bearer ${integrationSecret}`
    ) {
      request.resume()
      response.writeHead(404).end()
      return
    }

    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      const payload = JSON.parse(body) as {
        idempotency_key?: unknown
        occurred_at?: unknown
      }
      if (typeof payload.idempotency_key === 'string') {
        receivedKeys.push(payload.idempotency_key)
      }
      if (typeof payload.occurred_at === 'string') {
        receivedOccurredAts.push(payload.occurred_at)
      }
      if (!palAvailable) {
        response.writeHead(503, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ status: 503 }))
        return
      }
      response.writeHead(204).end()
    })
  })

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address() as AddressInfo
    process.env.PAL_ENABLED = 'true'
    process.env.PAL_API_URL = `http://127.0.0.1:${address.port}`
    process.env.PAL_INTEGRATION_SECRET = integrationSecret
    process.env.PAL_PSEUDONYM_SECRET = pseudonymSecret

    const { error: userError } = await supabase.from('users').insert({
      id: studentId,
      email,
      role: 'student',
      email_verified_at: new Date().toISOString(),
    })
    if (userError) throw new Error(`Failed to create recovery fixture user: ${userError.message}`)
    fixtureCreated = true

    const { error: configurationError } = await supabase.rpc(
      'record_pal_daily_log_week_configuration_atomic',
      {
        p_student_id: studentId,
        p_period_key: periodKey,
        p_config_version: 1,
        p_period_status: 'open',
        p_eligible_days: 3,
        p_configured_at: occurredAt.toISOString(),
        p_pal_event: event,
      },
    )
    if (configurationError) {
      throw new Error(`Failed to record weekly recovery fixture: ${configurationError.message}`)
    }

    const immediate = await attemptImmediatePalEventDelivery({ event, supabase })
    if (immediate !== 'pending') {
      throw new Error(`Unavailable Pal did not leave the event pending: ${immediate}`)
    }
    const { data: failedRow, error: failedError } = await supabase
      .from('pal_event_outbox')
      .select('status, attempts, last_error_code')
      .eq('idempotency_key', event.idempotency_key)
      .single()
    if (failedError) throw new Error(`Failed to read retry evidence: ${failedError.message}`)
    if (
      failedRow.status !== 'pending'
      || failedRow.attempts !== 1
      || failedRow.last_error_code !== 'http_503'
    ) {
      throw new Error('Unavailable Pal did not persist the expected retry evidence')
    }

    const { error: readyError } = await supabase
      .from('pal_event_outbox')
      .update({ next_attempt_at: '1900-01-01T00:00:00.000Z' })
      .eq('idempotency_key', event.idempotency_key)
    if (readyError) throw new Error(`Failed to ready recovery fixture: ${readyError.message}`)

    palAvailable = true
    const recovery = await deliverPalOutboxBatch({
      supabase,
      limit: 1,
      concurrency: 1,
    })
    if (recovery.delivered !== 1 || recovery.retrying !== 0) {
      throw new Error(`Queued recovery did not deliver exactly once: ${JSON.stringify(recovery)}`)
    }
    const { data: deliveredRow, error: deliveredError } = await supabase
      .from('pal_event_outbox')
      .select('status, attempts, delivered_at')
      .eq('idempotency_key', event.idempotency_key)
      .single()
    if (deliveredError) throw new Error(`Failed to read delivery evidence: ${deliveredError.message}`)
    if (
      deliveredRow.status !== 'delivered'
      || deliveredRow.attempts !== 2
      || deliveredRow.delivered_at === null
      || receivedKeys.length !== 2
      || receivedKeys.some((key) => key !== event.idempotency_key)
      || receivedOccurredAts.length !== 2
      || receivedOccurredAts.some((value) => value !== event.occurred_at)
    ) {
      throw new Error('Queued Pal event was not recovered with a stable key and source timestamp')
    }

    console.info('[pal-recovery-smoke]', JSON.stringify({
      immediate: 'pending',
      recovery: 'delivered',
      attempts: deliveredRow.attempts,
      stable_idempotency_key: true,
      stable_occurred_at: true,
    }))
  } finally {
    await closeServer(server)
    if (fixtureCreated) {
      const cleanupSql = `
        delete from public.pal_daily_log_week_configurations
        where student_id = '${studentId}' and period_key = '${periodKey}';
        delete from public.pal_event_outbox
        where idempotency_key = '${event.idempotency_key}';
        delete from public.users
        where id = '${studentId}' and email = '${email}';
        do $cleanup$
        begin
          if exists (
            select 1 from public.pal_daily_log_week_configurations
            where student_id = '${studentId}' and period_key = '${periodKey}'
          ) or exists (
            select 1 from public.pal_event_outbox
            where idempotency_key = '${event.idempotency_key}'
          ) or exists (
            select 1 from public.users
            where id = '${studentId}' and email = '${email}'
          ) then
            raise exception 'Pal recovery fixture cleanup was incomplete';
          end if;
        end
        $cleanup$;
      `
      execFileSync(
        'docker',
        ['exec', databaseContainer, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-c', cleanupSql],
        { stdio: 'ignore' },
      )
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Pal recovery smoke test failed')
  process.exitCode = 1
})
