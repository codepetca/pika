import { test } from '@playwright/test'
import { runContextualTestWorkflow } from './helpers/contextual-test-workflow'
import { contextualTestStartupBinding, createContextualTestStartup } from './helpers/contextual-test-startup'

const optedIn = process.env.PIKA_CONTEXTUAL_TEST_REHEARSAL === 'true'
const binding = optedIn ? contextualTestStartupBinding() : undefined
test.skip(!optedIn, 'Requires the independently admitted disposable rehearsal controller')

test('isolated contextual Tests: real owner/member lifecycle and fail-closed denials', async ({ browser }, testInfo) => {
  test.setTimeout(45 * 60 * 1000)
  // No native/controller work at collection. The dedicated config and factory
  // additionally bind the exact reviewed manifest; this flag alone grants none.
  const startup = createContextualTestStartup(binding!)
  try {
    startup.stage('spec-entry'); startup.stage('runtime-import')
    const { createContextualTestRuntime } = await import('./helpers/contextual-test-runtime')
    const owned = await createContextualTestRuntime(browser, testInfo, startup.stage)
    let outcome: 'passed' | 'failed' = 'failed'
    try { startup.stage('workflow'); await runContextualTestWorkflow(owned.runtime); outcome = 'passed' }
    catch (error) { startup.failure(error); throw error }
    finally { try { startup.stage('teardown') } finally { await owned.close(outcome) } }
  } catch (error) {
    startup.failure(error)
    // Playwright errors can contain form values, URLs and DOM text. Do not
    // attach their raw message/cause to the retained public test result.
    throw new Error('Isolated contextual Tests rehearsal failed; consult sanitized owned receipt')
  }
})
