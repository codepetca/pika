/** A login observation is never Survey, database, or full rehearsal acceptance. */
import assert from 'node:assert/strict'
import { isProxy } from 'node:util/types'
import type { ContextualTestRunBinding } from './contextual-test-rehearsal-binding'

export function assertContextualTestLoginSelection(value: { proofScope?: unknown; diagnostic?: unknown }): void {
  if (Object.hasOwn(value, 'diagnostic')) {
    assert.equal(value.diagnostic, 'login-only')
    assert.equal(value.proofScope, 'survey-workflow-v1')
  }
}
function data(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  assert(raw && typeof raw === 'object' && !isProxy(raw) && Object.getPrototypeOf(raw) === Object.prototype)
  assert.deepEqual(Reflect.ownKeys(raw).sort(), [...keys].sort())
  assert(Object.values(Object.getOwnPropertyDescriptors(raw)).every(d => 'value' in d))
  return raw as Record<string, unknown>
}
export function validateContextualTestLoginDiagnosticReceipt(raw: unknown, binding: ContextualTestRunBinding): void {
  assertContextualTestLoginSelection(binding); assert.equal(binding.diagnostic, 'login-only')
  const row = data(raw, ['version','kind','diagnostic','proofScope','projectId','nonce','sourceSha','sourceTree',
    'appOverlaySha256','deadline','endedAt','outcome','contextsClosed','pageErrors','actors','loginDiagnostic'])
  assert.equal(row.version, 1); assert.equal(row.kind, 'pika-login-only-v1')
  for (const key of ['diagnostic','proofScope','projectId','nonce','sourceSha','sourceTree','appOverlaySha256','deadline'] as const) assert.equal(row[key], binding[key])
  assert.equal(row.outcome, 'diagnostic-passed'); assert.equal(row.contextsClosed, true); assert.equal(row.pageErrors, 0)
  assert.deepEqual(row.actors, ['ownerTeacher'])
  assert(Number.isSafeInteger(row.endedAt) && Number(row.endedAt) >= binding.startedAt && Number(row.endedAt) < binding.deadline)
  const progress = data(row.loginDiagnostic, ['phase','observedAt','actorIndex','verified','failureObservedAt'])
  assert.equal(progress.phase, 'verified'); assert.equal(progress.actorIndex, 0); assert.equal(progress.verified, true)
  assert.equal(progress.failureObservedAt, null)
  assert(Number.isSafeInteger(progress.observedAt) && Number(progress.observedAt) >= binding.startedAt && Number(progress.observedAt) <= Number(row.endedAt))
}
