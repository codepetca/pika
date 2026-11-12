import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  alertConditions, checkRecoveryAlerts, missedRecoveryWindow, nextAlertState, recordAlertDelivery,
  recoveryAlertWindow, recoveryErrorStart, windowMs,
} from '../../workers/billing-recovery-alerts/checks.mjs'

const tick = Date.parse('2026-11-10T17:50:56.427Z')
const window = recoveryAlertWindow(tick)

describe('Pika billing recovery alerts', () => {
  it('starts with a private, disabled deployment and no heartbeat expectations', () => {
    const config = JSON.parse(readFileSync(new URL('../../workers/billing-recovery-alerts/wrangler.jsonc', import.meta.url), 'utf8'))
    expect(config).toMatchObject({
      workers_dev: false,
      preview_urls: false,
      triggers: { crons: [] },
      vars: {
        BILLING_ALERTS_ENABLED: 'false',
        BILLING_ALERT_EXPECT_PAID_HEARTBEAT: 'false',
        BILLING_ALERT_EXPECT_TRIAL_HEARTBEAT: 'false',
      },
    })
  })

  it('uses adjacent closed windows with two minutes for log ingestion', () => {
    expect(new Date(window.start).toISOString()).toBe('2026-11-10T17:38:00.000Z')
    expect(new Date(window.end).toISOString()).toBe('2026-11-10T17:48:00.000Z')
    expect(recoveryAlertWindow(tick + windowMs).start).toBe(window.end)
  })

  it('reports worker errors and a missing expected lane from independent counts', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ data: [{ value: '4' }] })
      .mockResolvedValueOnce({ data: [{ lane: 'paid', value: 2 }] })
    const result = await checkRecoveryAlerts({ query }, window, ['paid', 'trial'])
    expect(result).toEqual({ errorCount: 4, missingLanes: ['trial'] })
    expect(alertConditions(result)).toEqual(['recovery_errors', 'missing_trial'])
    for (const [request] of query.mock.calls) {
      expect(request.params).toEqual({
        start: '2026-11-10T17:38:00.000Z',
        end: '2026-11-10T17:48:00.000Z',
        script: 'pika-billing-recovery',
      })
    }
  })

  it('keeps an intentionally stopped lane quiet and rejects invalid results', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ data: [{ value: 0 }] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
    expect(await checkRecoveryAlerts({ query }, window, [])).toEqual({ errorCount: 0, missingLanes: [] })
    await expect(checkRecoveryAlerts({ query }, window, ['paid'])).rejects.toThrow('Invalid recovery alert analytics result')
    expect(alertConditions({ queryFailed: true })).toEqual(['analytics_unavailable'])
  })

  const error = { errorCount: 1, missingLanes: [] }
  const quiet = { errorCount: 0, missingLanes: [] }
  const queryFailed = { queryFailed: true }
  const alertAt = (previous: any, offset: number, result: any, id: string) => {
    const at = { start: window.start + offset, end: window.end + offset }
    return nextAlertState(previous, at, result, tick + offset, id)
  }

  it('keeps a failed delivery pending even after a quiet window or replay', () => {
    const first = alertAt(undefined, 0, error, 'first')
    expect(first.state.pending.map(alert => alert.id)).toEqual(['first'])
    const replay = alertAt(first.state, 0, null, 'replay')
    expect(replay.accepted).toBe(false)
    expect(replay.state.pending.map(alert => alert.id)).toEqual(['first'])
    const clean = alertAt(replay.state, windowMs, quiet, 'clean')
    expect(clean.state.pending.map(alert => alert.id)).toEqual(['first'])
    recordAlertDelivery(clean.state)
    expect(clean.state.pending).toEqual([])
    expect(alertAt(clean.state, 2 * windowMs, error, 'fresh').state.pending[0].id).toBe('fresh')
  })

  it('deduplicates a pending condition and repeats an ongoing condition after an hour', () => {
    const first = alertAt(undefined, 0, error, 'first')
    const continued = alertAt(first.state, windowMs, error, 'continued')
    expect(continued.state.pending.map(alert => alert.id)).toEqual(['first'])
    recordAlertDelivery(continued.state)
    expect(alertAt(continued.state, 2 * windowMs, error, 'quiet-repeat').state.pending).toEqual([])
    expect(alertAt(continued.state, 7 * windowMs, error, 'repeat').state.pending[0].id).toBe('repeat')
  })

  it('preserves the successful observation cursor across an analytics outage', async () => {
    const first = alertAt(undefined, 0, quiet, 'first')
    const outage = alertAt(first.state, windowMs, queryFailed, 'outage')
    expect(outage.state.observedThrough).toBe(window.end)
    expect(outage.state.pending[0].conditions).toEqual(['analytics_unavailable'])
    const latest = { start: window.start + 2 * windowMs, end: window.end + 2 * windowMs }
    expect(recoveryErrorStart(latest, outage.state.observedThrough)).toBe(window.end)
    expect(recoveryErrorStart(latest, null)).toBe(latest.end - 60 * 60_000)
    expect(missedRecoveryWindow(latest, { observedThrough: window.end, latestEnd: window.end + windowMs })).toBe(true)
    expect(missedRecoveryWindow(latest, { observedThrough: null, latestEnd: window.end + windowMs })).toBe(true)
    expect(missedRecoveryWindow(latest, { observedThrough: null, latestEnd: null })).toBe(false)
    expect(missedRecoveryWindow(latest, { observedThrough: null, latestEnd: latest.end })).toBe(false)
    const query = vi.fn().mockResolvedValueOnce({ data: [{ value: 1 }] }).mockResolvedValueOnce({ data: [] })
    const result = await checkRecoveryAlerts({ query }, { ...latest, errorStart: window.end }, ['paid'])
    expect(query.mock.calls[0][0].params.start).toBe(new Date(window.end).toISOString())
    expect(query.mock.calls[1][0].params.start).toBe(new Date(latest.start).toISOString())
    expect(result).toEqual({ errorCount: 1, missingLanes: ['paid'] })
    expect(alertConditions({ ...result, coverageGap: true })).toEqual(['recovery_errors', 'monitoring_gap', 'missing_paid'])
  })

  it('retains an unconfirmed delivery notice when the original retry key expires', () => {
    const first = alertAt(undefined, 0, error, 'first')
    const expired = alertAt(first.state, 3 * windowMs, error, 'expired')
    expect(expired.expired.map(alert => alert.id)).toEqual(['first'])
    expect(expired.state.pending.map(alert => alert.conditions)).toEqual([['delivery_unconfirmed']])
    const stillUnavailable = alertAt(expired.state, 6 * windowMs, quiet, 'summary-retry')
    expect(stillUnavailable.state.pending.map(alert => alert.id)).toEqual(['summary-retry'])
    expect(stillUnavailable.state.unconfirmedDelivery).toBe(true)
    recordAlertDelivery(stillUnavailable.state)
    expect(stillUnavailable.state.unconfirmedDelivery).toBe(false)
    expect(alertAt(stillUnavailable.state, 7 * windowMs, quiet, 'recovered').state.pending).toEqual([])
  })
})
