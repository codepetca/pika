import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  alertConditions, checkRecoveryAlerts, nextAlertState, recoveryAlertWindow, repeatMs, windowMs,
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

  it('deduplicates an older or repeated window and re-alerts after recovery or after one hour', () => {
    const previous = { end: window.end, notified: { recovery_errors: window.end } }
    expect(nextAlertState(previous, window.end, ['recovery_errors'])).toBeNull()
    expect(nextAlertState(previous, window.end - windowMs, ['recovery_errors'])).toBeNull()
    expect(nextAlertState(previous, window.end + windowMs, ['recovery_errors', 'missing_trial'])?.due).toEqual(['missing_trial'])
    expect(nextAlertState(previous, window.end + repeatMs, ['recovery_errors'])?.due).toEqual(['recovery_errors'])
    const clear = nextAlertState(previous, window.end + windowMs, [])
    expect(nextAlertState(clear?.state, window.end + 2 * windowMs, ['recovery_errors'])?.due).toEqual(['recovery_errors'])
  })

  it('keeps recovery notifications active across an analytics outage', () => {
    const previous = { end: window.end, notified: { missing_trial: window.end } }
    const outage = nextAlertState(previous, window.end + windowMs, ['analytics_unavailable'])
    expect(outage).toEqual({
      state: { end: window.end + windowMs, notified: previous.notified },
      due: ['analytics_unavailable'],
    })
    expect(nextAlertState(outage?.state, window.end + 2 * windowMs, ['missing_trial'])?.due).toEqual([])
  })
})
