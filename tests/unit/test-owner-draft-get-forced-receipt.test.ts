import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { evaluateDraftGetForcedReceipt, readPrivateForcedReceipt } from '../../scripts/check-test-owner-draft-get-forced-receipt.mjs'
import { createDraftGetNativeDiagnostic } from '../../scripts/contextual-test-draft-get-native-contracts'

const mode = 'after-fixture'
const marker = 'PASS isolated test-owner-draft-get exact teardown and unchanged canonical baseline.'
const fail = `FAIL forced isolated test-owner-draft-get lifecycle: ${mode}.`
const receipt = `${fail}\n${marker}\n`
const setup = 'DIAG test-owner-draft-get setup=sql-setup lifecycle=fixture cleanup=none failure=platform-command.'

describe('private draft GET forced receipt gate', () => {
  it('accepts only exact expected forced failures in either stream order', () => {
    expect(evaluateDraftGetForcedReceipt(mode, 1, receipt)).toEqual({ exitCode: 0, output: receipt })
    expect(evaluateDraftGetForcedReceipt(mode, 1, `${marker}\n${fail}\n`).exitCode).toBe(0)
    expect(evaluateDraftGetForcedReceipt('before-capture', 1, receipt.replace(mode, 'before-capture')).exitCode).toBe(0)
  })
  it.each([0, 2, 255])('refuses incorrect process status %s', status => {
    expect(evaluateDraftGetForcedReceipt(mode, status, receipt).exitCode).toBe(1)
  })
  it.each([receipt + '\n', receipt + 'noise\n', receipt.trimEnd(), `${fail}\n`, `${marker}\n${marker}\n`, receipt.replace(mode, 'before-capture')])('refuses incomplete or noisy receipts', input => {
    expect(evaluateDraftGetForcedReceipt(mode, 1, input).exitCode).toBe(1)
  })
  it('publishes only closed diagnostic fields, never raw output or injected values', () => {
    const privateText = 'private-key-or-path'
    const transport = 'DIAG test-owner-draft-get transport phase=guard operation=snapshot requests=31.'
    const forged = setup.replace('sql-setup', privateText)
    const input = `${privateText}\n${setup}\n${transport}\n${forged}\n${setup} ${privateText}\n`
    const result = evaluateDraftGetForcedReceipt(mode, 1, input)
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(setup)
    expect(result.output).toContain(transport)
    expect(result.output).not.toContain(privateText)
    expect(result.output).not.toContain('requests=32')
  })
  it('validates and reconstructs the actual finite native diagnostic', () => {
    const diagnostic = createDraftGetNativeDiagnostic(() => 0)
    diagnostic.stage('setup'); diagnostic.fail('control-command', 1)
    const native = diagnostic.format()
    expect(evaluateDraftGetForcedReceipt(mode, 1, native).output).toContain('"kind":"control-command"')
    for (const invalid of [native.replace('"setup"', '"secret"'), native.replace('"elapsedMs":0', '"elapsedMs":945001'), native.replace('"exitCode":1', '"exitCode":256'), native.replace('"cleanupKind":"none"', '"cleanupKind":"none","sql":"secret"')]) {
      expect(evaluateDraftGetForcedReceipt(mode, 1, invalid).output).not.toContain('DIAG')
    }
  })
  it('bounds output and input, withholding oversized or unreadable logs', () => {
    expect(evaluateDraftGetForcedReceipt(mode, 1, 'x'.repeat(16385)).output).toContain('lines=unavailable')
    expect(evaluateDraftGetForcedReceipt('secret', 1, setup).output).not.toContain('secret')
    const directory = mkdtempSync(join(tmpdir(), 'draft-get-receipt-'))
    try {
      const path = join(directory, 'private.log')
      writeFileSync(path, receipt, { mode: 0o600 })
      expect(readPrivateForcedReceipt(path)).toBe(receipt)
      expect(execFileSync('node', ['scripts/check-test-owner-draft-get-forced-receipt.mjs', mode, '1', path], { encoding: 'utf8' })).toBe(receipt)
      writeFileSync(path, 'x'.repeat(16385))
      expect(readPrivateForcedReceipt(path)).toBeNull()
    } finally { rmSync(directory, { recursive: true }) }
  })
  it('keeps private capture, deletion, both forced modes and the checked gate in CI', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
    const step = workflow.split('name: Verify isolated contextual Test owner-draft GET transactions')[1].split('\n      - name:')[0]
    expect(step).toContain('chmod 600')
    expect(step).toContain("trap 'rm -f")
    expect(step).toContain('in after-fixture before-capture')
    expect(step).toContain('node scripts/check-test-owner-draft-get-forced-receipt.mjs "$test_owner_draft_get_mode" "$test_owner_draft_get_status" "$test_owner_draft_get_log"')
  })
})
