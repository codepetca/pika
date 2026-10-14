/** Private local-test admission only. Never imported by application code. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readContextualTestBinding } from '../../scripts/contextual-test-rehearsal-binding'

export const CONTEXTUAL_TEST_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// Owner-approved installed Chrome155.0.8059.79; an update fails closed, not repinned.
export const CONTEXTUAL_TEST_CHROME_SHA256 = 'fbeec33e75ea8da7bdb6e48f987ed32f5089c49d86013046e87319f5df11c13f'
export function contextualTestConfigBinding() {
  assert.equal(process.env.PIKA_CONTEXTUAL_TEST_REHEARSAL, 'true', 'Private rehearsal opt-in required')
  const path = process.env.PIKA_CONTEXTUAL_TEST_BINDING_FILE, digest = process.env.PIKA_CONTEXTUAL_TEST_BINDING_SHA256
  assert(path && digest, 'Private rehearsal binding required')
  const binding = readContextualTestBinding(path, digest)
  assert(!existsSync(join(binding.outputDir, 'runner-output')), 'Private runner output already exists')
  return binding
}
export default async function contextualTestGlobalSetup() {
  try {
    const binding = contextualTestConfigBinding()
    assert.equal(process.platform, 'darwin')
    assert.equal(realpathSync(CONTEXTUAL_TEST_CHROME), CONTEXTUAL_TEST_CHROME)
    const file = lstatSync(CONTEXTUAL_TEST_CHROME); assert(file.isFile() && !file.isSymbolicLink() && (file.mode & 0o022) === 0)
    assert.equal(createHash('sha256').update(readFileSync(CONTEXTUAL_TEST_CHROME)).digest('hex'), CONTEXTUAL_TEST_CHROME_SHA256)
    // Exclusive start receipt blocks reuse even when a prior browser run failed.
    writeFileSync(join(binding.outputDir, 'playwright-started.json'), JSON.stringify({ version: 1, projectId: binding.projectId,
      sourceSha: binding.sourceSha, startedAt: Date.now(), deadline: binding.deadline }), { mode: 0o600, flag: 'wx' })
  } catch { throw new Error('Private contextual Test admission failed; no browser acceptance') }
}
