#!/usr/bin/env node
import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MAX_BYTES = 16384
const modes = ['after-fixture', 'before-capture']
const marker = 'PASS isolated test-owner-draft-get exact teardown and unchanged canonical baseline.'
const setup = /^DIAG test-owner-draft-get setup=(pending|app-guard|app-write|app-snapshot|app-verify|sql-prepare|sql-setup|complete|unknown) lifecycle=(canonical-before|preflight|prepare|pre-start|start|capture|status|fixture|cases|revocations|after-fixture|before-capture|unknown) cleanup=(none|present|unknown) failure=(assertion|platform-command|unknown)\.$/
const transport = /^DIAG test-owner-draft-get transport phase=(idle|context|validate|guard|dispatch|decode|complete|unknown) operation=(unknown|snapshot|inspect|create|repair) requests=(0|[1-9]|[12][0-9]|3[01])\.$/

/** Reconstruct only finite diagnostic fields; never publish exception/child output. */
function safeDiagnostic(line) {
  const match = setup.exec(line) ?? transport.exec(line)
  if (match) return match[0]
  const prefix = 'DIAG test-owner-draft-get native '
  if (!line.startsWith(prefix) || !line.endsWith('}.')) return null
  let value
  try { value = JSON.parse(line.slice(prefix.length, -1)) } catch { return null }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const fields = {
    stage: ['pending', 'setup', 'privilege-catalog', 'privilege-revoke', 'privilege-probe', 'privilege-restoration', 'rollback-contracts', 'bounds-drift', 'concurrency', 'complete'],
    phase: ['idle', 'guard', 'control', 'bootstrap', 'sql', 'verify', 'probe', 'frame', 'terminate', 'rollback', 'restoration'],
    schedule: ['none', 'contextual_create', 'contextual_repair', 'legacy_raw_insert', 'legacy_same_draft', 'legacy_other_draft_revision', 'start', 'save', 'publish', 'archive', 'owner_transfer', 'test_move', 'purge_fence'],
    kind: ['none', 'unknown', 'assertion', 'control-limit', 'control-command', 'control-timeout', 'action-limit', 'action-timeout', 'child-exit', 'child-error', 'frame-decode', 'output-limit', 'total-budget', 'termination', 'restoration'],
    cleanup: ['none', 'running', 'complete', 'failed'],
  }
  fields.cleanupKind = fields.kind
  const keys = [...Object.keys(fields), 'elapsedMs', 'exitCode'].sort()
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys)) return null
  if (!Object.entries(fields).every(([key, values]) => values.includes(value[key]))) return null
  if (!Number.isInteger(value.elapsedMs) || value.elapsedMs < 0 || value.elapsedMs > 945000) return null
  if (!Number.isInteger(value.exitCode) || value.exitCode < -1 || value.exitCode > 255) return null
  const safe = Object.fromEntries(keys.map(key => [key, value[key]]))
  return `${prefix}${JSON.stringify(safe)}.`
}

export function evaluateDraftGetForcedReceipt(mode, status, input) {
  if (!modes.includes(mode) || !Number.isInteger(status) || status < 0 || status > 255) {
    return { exitCode: 1, output: 'FAIL invalid forced-receipt checker input.\n' }
  }
  const bounded = typeof input === 'string' && Buffer.byteLength(input) <= MAX_BYTES
  const lines = bounded ? input.split('\n') : []
  const lineCount = bounded ? lines.length - 1 : 'unavailable'
  if (lines.at(-1) === '') lines.pop()
  const failure = `FAIL forced isolated test-owner-draft-get lifecycle: ${mode}.`
  if (bounded && status === 1 && lineCount === 2 && lines.length === 2 && lines.includes(failure) && lines.includes(marker)) {
    return { exitCode: 0, output: `${failure}\n${marker}\n` }
  }
  const diagnostics = [...new Set(lines.map(safeDiagnostic).filter(Boolean))].slice(0, 3)
  return { exitCode: 1, output: [`FAIL forced-receipt mismatch mode=${mode} status=${status} lines=${lineCount}.`, ...diagnostics].join('\n') + '\n' }
}

export function readPrivateForcedReceipt(path) {
  const fd = openSync(path, 'r')
  try {
    if (!fstatSync(fd).isFile()) return null
    const bytes = Buffer.alloc(MAX_BYTES + 1)
    const count = readSync(fd, bytes, 0, bytes.length, 0)
    return count > MAX_BYTES ? null : bytes.subarray(0, count).toString('utf8')
  } finally { closeSync(fd) }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let result
  try {
    const [mode, status, path, ...rest] = process.argv.slice(2)
    if (rest.length || !/^(0|[1-9][0-9]{0,2})$/.test(status ?? '') || !path) throw new Error('Invalid input')
    result = evaluateDraftGetForcedReceipt(mode, Number(status), readPrivateForcedReceipt(path))
  } catch { result = { exitCode: 1, output: 'FAIL private forced-receipt checker; details withheld.\n' } }
  process.stdout.write(result.output)
  process.exitCode = result.exitCode
}
