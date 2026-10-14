import { test } from '@playwright/test'
import { runContextualTestWorkflow } from './helpers/contextual-test-workflow'

test('isolated contextual Tests: real owner/member lifecycle and fail-closed denials', async ({ browser }, testInfo) => {
  test.skip(process.env.PIKA_CONTEXTUAL_TEST_REHEARSAL !== 'true', 'Requires the independently admitted disposable rehearsal controller')
  test.setTimeout(45 * 60 * 1000)
  // No native/controller work at collection. The dedicated config and factory
  // additionally bind the exact reviewed manifest; this flag alone grants none.
  try {
    const { createContextualTestRuntime } = await import('./helpers/contextual-test-runtime')
    const owned = await createContextualTestRuntime(browser, testInfo)
    let outcome: 'passed' | 'failed' = 'failed'
    try { await runContextualTestWorkflow(owned.runtime); outcome = 'passed' } finally { await owned.close(outcome) }
  } catch {
    // Playwright errors can contain form values, URLs and DOM text. Do not
    // attach their raw message/cause to the retained public test result.
    throw new Error('Isolated contextual Tests rehearsal failed; consult sanitized owned receipt')
  }
})
