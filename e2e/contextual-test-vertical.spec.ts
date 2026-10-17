import { test } from '@playwright/test'
import { contextualTestStartupBinding, createContextualTestStartup } from './helpers/contextual-test-startup'
const optedIn = process.env.PIKA_CONTEXTUAL_TEST_REHEARSAL === 'true' && process.env.PIKA_CONTEXTUAL_TEST_VERTICAL === 'true'
const binding = optedIn ? contextualTestStartupBinding() : undefined
test.skip(!optedIn, 'Requires the separately reviewed narrow disposable controller')
test('one real mixed-role Test: create publish submit inspect and deny', async ({ browser }) => {
  const startup = createContextualTestStartup(binding!)
  try {
    startup.stage('spec-entry'); test.setTimeout(Math.max(1, binding!.deadline - Date.now()))
    const { createContextualTestVerticalRuntime } = require('./helpers/contextual-test-vertical-runtime') as typeof import('./helpers/contextual-test-vertical-runtime')
    const { runContextualTestVerticalWorkflow } = require('./helpers/contextual-test-vertical-workflow') as typeof import('./helpers/contextual-test-vertical-workflow')
    const { runContextualTestGradeReturnWorkflow } = require('./helpers/contextual-test-grade-return-workflow') as typeof import('./helpers/contextual-test-grade-return-workflow')
    const owned = await createContextualTestVerticalRuntime(browser)
    let result: Awaited<ReturnType<typeof runContextualTestVerticalWorkflow | typeof runContextualTestGradeReturnWorkflow>> | null = null, failure: unknown
    try { startup.stage('workflow'); result = await (binding!.proofScope === 'vertical-grade-return-v1'
      ? runContextualTestGradeReturnWorkflow(owned.runtime) : runContextualTestVerticalWorkflow(owned.runtime)) }
    catch (error) { failure = error; startup.failure(error) }
    finally { startup.stage('teardown'); await owned.close(result, failure) }
  } catch (error) { startup.failure(error); throw new Error('Narrow Test workflow failed; inspect fixed private receipt') }
})
