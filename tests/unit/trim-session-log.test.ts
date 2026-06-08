import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const scriptPath = resolve(testDir, '../../scripts/trim-session-log.mjs')

describe('trim-session-log script', () => {
  it('keeps only the latest requested session entries', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'pika-session-log-'))

    try {
      const sourcePath = join(repoRoot, 'source.md')
      const outputPath = join(repoRoot, 'SESSION-LOG.md')

      writeFileSync(
        sourcePath,
        [
          '# Pika Project Journal',
          '',
          '## 2026-05-01 - First',
          'first entry',
          '',
          '## 2026-05-02 - Second',
          'second entry',
          '',
          '## 2026-05-03 - Third',
          'third entry',
          '',
        ].join('\n'),
      )

      execFileSync(
        'node',
        [scriptPath, '--source', sourcePath, '--output', outputPath, '--keep', '2'],
        { cwd: repoRoot },
      )

      const output = readFileSync(outputPath, 'utf8')

      expect(output).toContain('# Pika Session Log')
      expect(output).toContain('latest 60 entries')
      expect(output).toContain('Append one concise entry for meaningful work, then immediately run `node scripts/trim-session-log.mjs` in the same change.')
      expect(output).not.toContain('## 2026-05-01 - First')
      expect(output).toContain('## 2026-05-02 - Second')
      expect(output).toContain('## 2026-05-03 - Third')
      expect(output.match(/^## /gm)).toHaveLength(2)
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('resolves default paths from the script repo, not process cwd', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'pika-session-log-repo-'))
    const otherCwd = mkdtempSync(join(tmpdir(), 'pika-session-log-cwd-'))

    try {
      mkdirSync(join(repoRoot, 'scripts'), { recursive: true })
      mkdirSync(join(repoRoot, '.ai'), { recursive: true })

      const copiedScriptPath = join(repoRoot, 'scripts/trim-session-log.mjs')
      writeFileSync(copiedScriptPath, readFileSync(scriptPath, 'utf8'))
      writeFileSync(
        join(repoRoot, '.ai/SESSION-LOG.md'),
        [
          '# Pika Session Log',
          '',
          '## 2026-05-01 - First',
          'first entry',
          '',
          '## 2026-05-02 - Second',
          'second entry',
          '',
        ].join('\n'),
      )

      execFileSync('node', [copiedScriptPath, '--keep', '1'], { cwd: otherCwd })

      const output = readFileSync(join(repoRoot, '.ai/SESSION-LOG.md'), 'utf8')

      expect(output).not.toContain('## 2026-05-01 - First')
      expect(output).toContain('## 2026-05-02 - Second')
      expect(output.match(/^## /gm)).toHaveLength(1)
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
      rmSync(otherCwd, { recursive: true, force: true })
    }
  })

  it('defaults to a weekly evidence-sized retention window', () => {
    const script = readFileSync(scriptPath, 'utf8')

    expect(script).toContain('const DEFAULT_KEEP = 60')
    expect(script).toContain('[--keep 60]')
    expect(script).toContain('--check')
  })

  it('checks whether the session log is already trimmed without writing it', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'pika-session-log-check-'))

    try {
      const sourcePath = join(repoRoot, 'source.md')
      const original = [
        '# Pika Session Log',
        '',
        '## 2026-05-01 - First',
        'first entry',
        '',
        '## 2026-05-02 - Second',
        'second entry',
        '',
        '## 2026-05-03 - Third',
        'third entry',
        '',
      ].join('\n')

      writeFileSync(sourcePath, original)

      const failedCheck = spawnSync('node', [scriptPath, '--check', '--source', sourcePath, '--keep', '2'], {
        cwd: repoRoot,
        encoding: 'utf8',
      })

      expect(failedCheck.status).toBe(1)
      expect(failedCheck.stderr).toContain('run node scripts/trim-session-log.mjs')
      expect(readFileSync(sourcePath, 'utf8')).toBe(original)

      const output = execFileSync('node', [scriptPath, '--check', '--source', sourcePath, '--keep', '3'], {
        cwd: repoRoot,
        encoding: 'utf8',
      })

      expect(output).toContain('source.md is trimmed: 3/3 entries')
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })
})
