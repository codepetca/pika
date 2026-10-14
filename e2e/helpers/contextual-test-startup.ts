/** Inert private reporting only; never creates admission or dispatches work. */
import assert from 'node:assert/strict'
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { types } from 'node:util'
import { classifyDiagnosticError, diagnosticDirectory, diagnosticRead, validateDiagnosticReport, type DiagnosticError, type DiagnosticReport } from '../../scripts/contextual-browser-diagnostic-data'
import { observeFixtureError, validateFixtureErrorObservation, type FixtureErrorObservation } from '../../scripts/contextual-fixture-error-observation'
import { readContextualTestBinding, type ContextualTestRunBinding } from '../../scripts/contextual-test-rehearsal-binding'

const stages = ['collection','fixture','spec-entry','runtime-import','runtime-imported','runtime-entry','binding','plan','boundary','output','runtime-ready','workflow','teardown'] as const
export type ContextualTestStartupStage = typeof stages[number]
type Identity = { version: 1; projectId: string; nonce: string; sourceSha: string; deadline: number }
type Record = Identity & { stage: ContextualTestStartupStage; error: DiagnosticError | null; observation?: FixtureErrorObservation }
export type FullStartupReport = Identity & { report: DiagnosticReport; reached: ContextualTestStartupStage[]; failure: { stage: ContextualTestStartupStage; error: DiagnosticError; observation?: FixtureErrorObservation } | null; observations?: FixtureErrorObservation[] }
const fixedError = () => new Error('Private contextual Test startup reporting failed')
function exact(value: unknown, keys: string[], optional: string[] = []): asserts value is { [key: string]: unknown } {
  assert(value && typeof value === 'object' && !types.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype)
  const ownKeys = Reflect.ownKeys(value)
  assert(ownKeys.every(key => typeof key === 'string' && (keys.includes(key) || optional.includes(key))))
  assert(keys.every(key => ownKeys.includes(key)))
  assert(Object.values(Object.getOwnPropertyDescriptors(value)).every(d => 'value' in d))
}
function identity(binding: Pick<ContextualTestRunBinding, 'projectId' | 'nonce' | 'sourceSha' | 'deadline'>): Identity {
  return { version: 1, projectId: binding.projectId, nonce: binding.nonce, sourceSha: binding.sourceSha, deadline: binding.deadline }
}
const identityKeys = ['version','projectId','nonce','sourceSha','deadline']
function validateIdentity(value: Identity) {
  assert(typeof value.projectId === 'string' && typeof value.nonce === 'string' && typeof value.sourceSha === 'string')
  assert(value.version === 1 && /^pika_assignment_list_[a-f0-9]{12}$/.test(value.projectId))
  assert(/^[a-f0-9]{32}$/.test(value.nonce) && value.nonce.endsWith(value.projectId.slice(-12)))
  assert(/^[a-f0-9]{40}$/.test(value.sourceSha) && Number.isSafeInteger(value.deadline))
}
function validateError(error: DiagnosticError) {
  exact(error, ['category','code','signal','source'])
  validateDiagnosticReport({ version: 1, status: 'failed', discovered: 0, started: 0, ended: 0, passed: 0, errors: [error], overflow: false })
}
export function validateContextualTestStartupRecord(raw: unknown): Record {
  exact(raw, [...identityKeys, 'stage','error'], ['observation']); const value = raw as Record
  validateIdentity(value); assert(stages.includes(value.stage))
  if (value.error !== null) validateError(value.error)
  if ('observation' in value) {
    assert(value.error !== null)
    assert.equal(validateFixtureErrorObservation(value.observation).event, 'body')
  }
  return value
}
export function validateFullStartupReport(raw: unknown, binding: ContextualTestRunBinding): FullStartupReport {
  exact(raw, [...identityKeys, 'report','reached','failure'], ['observations']); const value = raw as FullStartupReport
  exact(value.report, ['version','status','discovered','started','ended','passed','errors','overflow'])
  function array(items: unknown, limit: number): asserts items is unknown[] {
    assert(Array.isArray(items) && !types.isProxy(items) && Object.getPrototypeOf(items) === Array.prototype)
    assert(items.length <= limit)
    assert.deepEqual(Reflect.ownKeys(items).sort(), [...Array.from({ length: items.length }, (_, i) => String(i)), 'length'].sort())
    assert(Object.values(Object.getOwnPropertyDescriptors(items)).every(d => 'value' in d))
  }
  array(value.report.errors, 8); for (const error of value.report.errors) validateError(error)
  if ('observations' in value) {
    array(value.observations, 8)
    assert.equal(value.observations.length, value.report.errors.length)
    for (const observation of value.observations) assert.notEqual(validateFixtureErrorObservation(observation).event, 'body')
  }
  validateIdentity(value); validateDiagnosticReport(value.report)
  array(value.reached, stages.length)
  assert(value.reached.every((stage, i) => stages.includes(stage) && (i === 0 || stages.indexOf(stage) > stages.indexOf(value.reached[i - 1]))))
  if (value.failure !== null) {
    exact(value.failure, ['stage','error'], ['observation']); assert(stages.includes(value.failure.stage)); validateError(value.failure.error)
    if ('observation' in value.failure) assert.equal(validateFixtureErrorObservation(value.failure.observation).event, 'body')
    assert(value.reached.includes(value.failure.stage))
  }
  assert.deepEqual(identity(value), identity(binding)); return JSON.parse(JSON.stringify(value)) as FullStartupReport
}
/** Full rehearsal's original binding/clock, never the browser-only 90s admission. */
export function contextualTestStartupBinding() {
  try {
    assert.equal(process.env.PIKA_CONTEXTUAL_TEST_REHEARSAL, 'true')
    const file = process.env.PIKA_CONTEXTUAL_TEST_BINDING_FILE, digest = process.env.PIKA_CONTEXTUAL_TEST_BINDING_SHA256
    assert(file && digest); return readContextualTestBinding(file, digest)
  } catch { throw new Error('Private contextual Test binding rejected') }
}
function write(binding: ContextualTestRunBinding, name: string, value: unknown) {
  try {
    assert(Date.now() >= binding.startedAt && Date.now() < binding.cleanupDeadline)
    diagnosticDirectory(binding.outputDir); const parent = lstatSync(binding.outputDir)
    const bytes = JSON.stringify(value); assert(Buffer.byteLength(bytes) <= 8192)
    const file = join(binding.outputDir, name)
    const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    try {
      const s = fstatSync(fd); assert(s.isFile() && s.nlink === 1 && s.uid === parent.uid && (s.mode & 0o777) === 0o600)
      writeFileSync(fd, bytes)
      const named = lstatSync(file); assert(named.dev === s.dev && named.ino === s.ino && named.nlink === 1)
      diagnosticDirectory(binding.outputDir); const after = lstatSync(binding.outputDir)
      assert(parent.dev === after.dev && parent.ino === after.ino)
    } finally { closeSync(fd) }
  } catch { throw fixedError() }
}
function readRecord(binding: ContextualTestRunBinding, name: string) {
  const record = validateContextualTestStartupRecord(JSON.parse(diagnosticRead(join(binding.outputDir, name), 8192)))
  assert.deepEqual(identity(record), identity(binding)); return record
}
export function createContextualTestStartup(binding: ContextualTestRunBinding) {
  let stage: ContextualTestStartupStage = 'spec-entry', failed = false, previous = -1
  return {
    stage(next: ContextualTestStartupStage) {
      assert(stages.indexOf(next) > previous); previous = stages.indexOf(next); stage = next
      const record = validateContextualTestStartupRecord({ ...identity(binding), stage, error: null })
      write(binding, `startup-${stage}.json`, record)
    },
    failure(error: unknown) {
      if (failed) return; failed = true
      const record = validateContextualTestStartupRecord({ ...identity(binding), stage, error: classifyDiagnosticError(error), observation: observeFixtureError(error, 'body') })
      write(binding, 'startup-failure.json', record)
    },
  }
}
export function writeFullStartupReport(binding: ContextualTestRunBinding, report: DiagnosticReport, observations?: FixtureErrorObservation[]) {
  const reached = stages.filter(stage => {
    const name = `startup-${stage}.json`; if (!existsSync(join(binding.outputDir, name))) return false
    const record = readRecord(binding, name); assert(record.stage === stage && record.error === null && !('observation' in record)); return true
  })
  const failure = existsSync(join(binding.outputDir, 'startup-failure.json')) ? readRecord(binding, 'startup-failure.json') : null
  if (failure) assert(failure.error !== null)
  const value = validateFullStartupReport({ ...identity(binding), report, reached, failure: failure ? { stage: failure.stage, error: failure.error, ...('observation' in failure ? { observation: failure.observation } : {}) } : null, ...(observations === undefined ? {} : { observations }) }, binding)
  write(binding, 'startup-report.json', value)
}
/** Receipt-only read accepts an already validated binding after work expiry. */
export function readFullStartupReport(binding: ContextualTestRunBinding): FullStartupReport {
  return validateFullStartupReport(JSON.parse(diagnosticRead(join(binding.outputDir, 'startup-report.json'), 8192)), binding)
}
