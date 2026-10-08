import { afterEach, expect, it, vi } from 'vitest'
import { prepareDailyLogPal } from '@/lib/server/daily-log-pal'
import * as events from '@/lib/server/pal-events'
import { expectContentFreeDiagnostic, privateDiagnosticError } from '../../helpers/diagnostics'

const input = { learnerId: 'student-1', activityDay: '2026-09-16', occurredAt: new Date('2026-09-16T12:00:00Z'), text: 'Private reflection' }
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

it('contains event preparation errors without logging student content', () => {
  vi.stubEnv('PAL_ENABLED', 'true')
  vi.stubEnv('PAL_API_URL', 'https://pal.example.test')
  vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret-32-characters-long')
  vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret-32-characters-long')
  vi.stubEnv('PAL_CLASSROOM_ENABLED', 'false')
  vi.spyOn(events, 'buildDailyLogCompletedEvent').mockImplementation(() => { throw privateDiagnosticError })
  const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(prepareDailyLogPal(input)).toEqual({ enabled: false, event: null })
  expectContentFreeDiagnostic(diagnostic.mock.calls, 'daily_log.pal_prepare')
})

it('does not validate configuration or prepare facts when Pal is disabled', () => {
  vi.stubEnv('PAL_ENABLED', 'false')
  vi.stubEnv('PAL_INTEGRATION_SECRET', '')
  const build = vi.spyOn(events, 'buildDailyLogCompletedEvent')
  const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(prepareDailyLogPal(input)).toEqual({ enabled: false, event: null })
  expect(build).not.toHaveBeenCalled()
  expect(diagnostic).not.toHaveBeenCalled()
})
