/** Opt-in private timing receipts. No operations occur at import. */
import assert from 'node:assert/strict'
import { closeSync, constants, fstatSync, lstatSync, openSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import type { AssignmentListLifecycleAdapters } from './contextual-assignment-list-proof-lifecycle'

type Profile = 'test-owner-detail' | 'test-owner-list'
type Mode = 'normal' | 'after-fixture' | 'before-capture'
const operations = ['canonicalSnapshot', 'inventory', 'prepare', 'start', 'status', 'command', 'verifyEphemeral', 'executeSql', 'runCase', 'runRevocation', 'verifyRestoration', 'teardown', 'removeWorkdir'] as const
type Operation = typeof operations[number]

/** Preserve the original four-argument parser; accept one exact trailing option. */
export function extractContextualProofTimingArgs(args: string[]) {
  assert(args.length === 4 || args.length === 6)
  if (args.length === 4) return { lifecycleArgs: args, timingsPath: undefined }
  assert.equal(args[4], '--timings-path')
  assert(typeof args[5] === 'string' && isAbsolute(args[5]) && resolve(args[5]) === args[5])
  return { lifecycleArgs: args.slice(0, 4), timingsPath: args[5] }
}

export function createContextualProofTimings(input: { path?: string; reviewedSha: string; profile: Profile; mode: Mode }, now: () => number = () => performance.now()) {
  assert.match(input.reviewedSha, /^[a-f0-9]{40}$/)
  assert(['test-owner-detail', 'test-owner-list'].includes(input.profile))
  assert(['normal', 'after-fixture', 'before-capture'].includes(input.mode))
  let descriptor: number | undefined
  if (input.path !== undefined) {
    assert(isAbsolute(input.path) && resolve(input.path) === input.path)
    const parent = dirname(input.path)
    assert.equal(realpathSync(parent), parent, 'Timing directory must have no symlink ancestors')
    descriptor = openSync(input.path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  }
  const records = new Map<Operation, { calls: number; failedCalls: number; durationMs: number }>()
  let ran = false
  async function measure<T>(operation: Operation, action: () => Promise<T>): Promise<T> {
    if (descriptor === undefined) return action()
    const record = records.get(operation) ?? { calls: 0, failedCalls: 0, durationMs: 0 }
    records.set(operation, record); record.calls++
    const start = now()
    try { return await action() }
    catch (error) { record.failedCalls++; throw error }
    finally { record.durationMs += Math.max(0, now() - start) }
  }
  function decorate(adapters: AssignmentListLifecycleAdapters): AssignmentListLifecycleAdapters {
    if (descriptor === undefined) return adapters
    return {
      canonicalSnapshot: request => measure('canonicalSnapshot', () => adapters.canonicalSnapshot(request)),
      inventory: request => measure('inventory', () => adapters.inventory(request)),
      prepare: (plan, migrations) => measure('prepare', () => adapters.prepare(plan, migrations)),
      command: request => measure(request.args[0] === 'start' ? 'start' : request.args[0] === 'status' ? 'status' : 'command', () => adapters.command(request)),
      verifyEphemeral: request => measure('verifyEphemeral', () => adapters.verifyEphemeral(request)),
      executeSql: request => measure('executeSql', () => adapters.executeSql(request)),
      runCase: request => measure('runCase', () => adapters.runCase(request)),
      runRevocation: request => measure('runRevocation', () => adapters.runRevocation(request)),
      verifyRestoration: request => measure('verifyRestoration', () => adapters.verifyRestoration(request)),
      teardown: request => measure('teardown', () => adapters.teardown(request)),
      removeWorkdir: request => measure('removeWorkdir', () => adapters.removeWorkdir(request)),
    }
  }
  async function run<T>(action: () => Promise<T>): Promise<T> {
    assert(!ran); ran = true
    const start = now(); let outcome: 'passed' | 'failed' = 'failed'
    try { const result = await action(); outcome = 'passed'; return result }
    finally {
      if (descriptor !== undefined) {
        try {
          const file = fstatSync(descriptor); const current = lstatSync(input.path!)
          assert(file.isFile() && current.isFile() && file.dev === current.dev && file.ino === current.ino && file.size === 0 && (file.mode & 0o777) === 0o600)
          const receipt = { version: 1, reviewedSha: input.reviewedSha, profile: input.profile, mode: input.mode, outcome,
            durationMs: Math.max(0, now() - start),
            operations: operations.filter(operation => records.has(operation)).map(operation => ({ operation, ...records.get(operation)!, outcome: records.get(operation)!.failedCalls ? 'failed' : 'passed' })) }
          writeFileSync(descriptor, `${JSON.stringify(receipt)}\n`, 'utf8')
        } finally { closeSync(descriptor); descriptor = undefined }
      }
    }
  }
  return { decorate, run }
}
