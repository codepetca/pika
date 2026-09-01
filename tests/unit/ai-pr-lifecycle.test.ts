import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseArgs, readEvents, summarizeEvents } from '../../scripts/record-ai-pr-lifecycle.mjs'

const script = join(process.cwd(), 'scripts/record-ai-pr-lifecycle.mjs')

describe('AI PR lifecycle recorder', () => {
  it('keeps unreported active time and token components unknown', () => {
    expect(parseArgs(['event', '--pr', '42', '--event', 'started']).values).toMatchObject({ pr: 42, event: 'started' })
  })

  it('summarizes attributable metrics separately from CI and quality', () => {
    expect(summarizeEvents([
      { pr: 42, event: 'started', recordedAt: '2026-09-01T00:00:00Z' },
      { pr: 42, event: 'implementation', recordedAt: '2026-09-01T00:01:00Z', activeSeconds: 120, inputTokens: 50, outputTokens: 75 },
      { pr: 42, event: 'ci-passed', recordedAt: '2026-09-01T00:02:00Z', ciQueueSeconds: 3, ciRunSeconds: 480, quality: 'passed' },
      { pr: 7, event: 'implementation', recordedAt: '2026-09-01T00:03:00Z', activeSeconds: 999 },
    ], 42)).toMatchObject({ activeDevelopmentSeconds: 120, tokens: { input: 50, output: 75, reasoning: null }, ci: { queueSeconds: 3, runSeconds: 480 }, quality: 'passed' })
  })

  it('writes append-only local JSONL through the CLI', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pika-ai-pr-lifecycle-'))
    const log = join(directory, 'metrics.jsonl')
    try {
      execFileSync('node', [script, 'event', '--log', log, '--pr', '42', '--event', 'remediation', '--correction-or-sync-pushes', '1'])
      expect(readEvents(log)[0]).toMatchObject({ pr: 42, event: 'remediation', correctionOrSyncPushes: 1 })
      expect(readFileSync(log, 'utf8')).toContain('"event":"remediation"')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('rejects fabricated negative metrics and unknown stages', () => {
    expect(() => parseArgs(['event', '--pr', '42', '--event', 'invented'])).toThrow('--event must be one of')
    expect(() => parseArgs(['event', '--pr', '42', '--event', 'started', '--active-seconds', '-1'])).toThrow('--active-seconds must be a non-negative integer')
    expect(() => parseArgs(['event', '--pr', '42', '--event', 'started', '--made-up', '1'])).toThrow('Unknown argument')
  })
})
