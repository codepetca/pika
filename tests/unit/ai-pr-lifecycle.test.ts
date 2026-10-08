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
    ], 42)).toMatchObject({ trackingStartedAt: '2026-09-01T00:00:00Z', activeDevelopmentSeconds: 120, tokens: { input: 50, output: 75, reasoning: null }, ci: { queueSeconds: 3, runSeconds: 480 }, quality: 'passed' })
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

  it('ignores a corrected merge timestamp without deleting the original record', () => {
    const events = [
      { pr: 42, event: 'merged', recordedAt: '2026-10-07T10:26:24Z', quality: 'passed' },
      { pr: 7, event: 'merge-recording-correction', recordedAt: '2026-10-07T10:26:30Z', invalidatesRecordedAt: '2026-10-07T10:26:24Z' },
    ]
    expect(summarizeEvents(events, 42).completedAt).toBe('2026-10-07T10:26:24Z')
    events.push({ pr: 42, event: 'merge-recording-correction', recordedAt: '2026-10-07T10:26:53Z', invalidatesRecordedAt: '2026-10-07T10:26:24Z' })
    expect(summarizeEvents(events, 42).completedAt).toBeNull()
    events.push({ pr: 42, event: 'merged', recordedAt: '2026-10-07T11:32:54Z', quality: 'passed' })
    expect(summarizeEvents(events, 42).completedAt).toBe('2026-10-07T11:32:54Z')
    expect(events).toHaveLength(4)
  })

  it('records one identified review attempt separately from stage events and CI waiting', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pika-ai-pr-review-'))
    const log = join(directory, 'metrics.jsonl')
    const head = 'a'.repeat(40)
    const args = [script, 'event', '--log', log, '--pr', '42', '--event', 'independent-review',
      '--review-id', 'reviewer-1:turn-1', '--head-sha', head, '--model', 'gpt-6-luna', '--effort', 'medium',
      '--coverage', 'complete', '--review-seconds', '40', '--input-tokens', '100', '--cached-input-tokens', '80',
      '--output-tokens', '10', '--accepted-findings', '1', '--rejected-findings', '0']
    try {
      execFileSync('node', args)
      expect(readEvents(log)[0]).toMatchObject({ reviewId: 'reviewer-1:turn-1', headSha: head, model: 'gpt-6-luna', coverage: 'complete', reviewSeconds: 40 })
      expect(() => execFileSync('node', args, { stdio: 'pipe' })).toThrow()
      expect(readEvents(log)).toHaveLength(1)
      expect(summarizeEvents([
        ...readEvents(log),
        { pr: 42, event: 'independent-review', recordedAt: '2026-10-07T12:00:00Z' },
        { pr: 42, event: 'ci-passed', recordedAt: '2026-10-07T13:00:00Z', ciRunSeconds: 3600 },
      ], 42)).toMatchObject({
        activeDevelopmentSeconds: null,
        reviews: { recordedAttempts: 1, unidentifiedEvents: 1, elapsedSeconds: 40, acceptedFindings: 1, rejectedFindings: 0 },
        tokens: { input: 100, cachedInput: 80, output: 10, reasoning: null },
        ci: { runSeconds: 3600 },
      })
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('keeps legacy review measurements unknown and rejects misleading review metadata', () => {
    expect(summarizeEvents([{ pr: 42, event: 'independent-review', recordedAt: '2026-10-07T12:00:00Z' }], 42))
      .toMatchObject({ reviews: { recordedAttempts: null, unidentifiedEvents: 1, elapsedSeconds: null, acceptedFindings: null, rejectedFindings: null } })
    const args = ['event', '--pr', '42', '--event', 'independent-review', '--review-id', 'reviewer-1:turn-1']
    expect(() => parseArgs([...args, '--coverage', 'unknown'])).toThrow('--coverage')
    expect(() => parseArgs([...args, '--head-sha', 'not-a-sha'])).toThrow('--head-sha')
    expect(() => parseArgs([...args, '--review-seconds', '-1'])).toThrow('--review-seconds')
    expect(() => parseArgs([...args, '--input-tokens', '10', '--cached-input-tokens', '11'])).toThrow('--cached-input-tokens')
    expect(() => parseArgs(['event', '--pr', '42', '--event', 'started', '--model', 'gpt-6-luna'])).toThrow('review')
  })
})
