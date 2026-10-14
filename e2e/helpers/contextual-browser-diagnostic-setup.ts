import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { diagnosticAdmissionFromEnvironment, diagnosticRead } from '../../scripts/contextual-browser-diagnostic-data'

/** Keep the runner alive until its native parent has positively captured birth.
 * Polling a private token is a handshake, never a process/closure witness. */
export default async function diagnosticOwnershipHandshake() {
  const a = diagnosticAdmissionFromEnvironment(), end = Math.min(a.deadline, Date.now() + 30000)
  const file = join(a.outputDir, 'owned-ready.json')
  while (!existsSync(file)) {
    assert(Date.now() < end, 'Private diagnostic ownership handshake expired')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  const token = JSON.parse(diagnosticRead(file))
  assert.deepEqual(Object.keys(token).sort(), ['nonce','version'])
  assert(token.version === 1 && token.nonce === a.nonce && Date.now() < end)
}
