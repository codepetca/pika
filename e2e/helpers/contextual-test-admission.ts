/** Private local-test admission only. Never imported by application code. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { contextualTestStartupBinding } from './contextual-test-startup'
import { assertContextualTestUnusedRunnerOutput } from '../../scripts/contextual-test-rehearsal-launch'

export const CONTEXTUAL_TEST_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// Owner-approved installed Chrome155.0.8059.84; an update fails closed, not repinned.
export const CONTEXTUAL_TEST_CHROME_SHA256 = '63ee57066ef61169445ded279701d974ad23c805a60b8f77a4b8776183ac58fb'
export function contextualTestConfigBinding() {
  try {
    // Playwright reloads config in a worker after creating its own output. This
    // is a binding read, not a new attempt or permission to adopt prior output.
    return contextualTestStartupBinding()
  } catch { throw new Error('Private contextual Test admission rejected') }
}
export default async function contextualTestGlobalSetup() {
  try {
    const binding = contextualTestConfigBinding()
    assertContextualTestUnusedRunnerOutput(binding.outputDir)
    assert.equal(process.platform, 'darwin')
    assert.equal(realpathSync(CONTEXTUAL_TEST_CHROME), CONTEXTUAL_TEST_CHROME)
    const file = lstatSync(CONTEXTUAL_TEST_CHROME); assert(file.isFile() && !file.isSymbolicLink() && (file.mode & 0o022) === 0)
    assert.equal(createHash('sha256').update(readFileSync(CONTEXTUAL_TEST_CHROME)).digest('hex'), CONTEXTUAL_TEST_CHROME_SHA256)
    // Exclusive start receipt blocks reuse even when a prior browser run failed.
    writeFileSync(join(binding.outputDir, 'playwright-started.json'), JSON.stringify({ version: 1, projectId: binding.projectId,
      sourceSha: binding.sourceSha, startedAt: Date.now(), deadline: binding.deadline }), { mode: 0o600, flag: 'wx' })
  } catch { throw new Error('Private contextual Test admission failed; no browser acceptance') }
}
