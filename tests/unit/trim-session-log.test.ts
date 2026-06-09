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
      expect(output).toContain('CI allows at most 60 entries')
      expect(output).toContain('compacts to the latest 40 entries')
      expect(output).toContain('Append one concise entry for meaningful work, then immediately run `node scripts/trim-session-log.mjs` in the same change.')
      expect(output).not.toContain('## 2026-05-01 - First')
      expect(output).toContain('## 2026-05-02 - Second')
      expect(output).toContain('## 2026-05-03 - Third')
      expect(output.match(/^## /gm)).toHaveLength(2)
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('defaults to compacting below the CI cap', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'pika-session-log-buffer-'))

    try {
      const sourcePath = join(repoRoot, 'source.md')
      const outputPath = join(repoRoot, 'SESSION-LOG.md')
      const entries = Array.from({ length: 61 }, (_, index) => {
        const day = String((index % 28) + 1).padStart(2, '0')
        return [`## 2026-05-${day} - Entry ${index + 1}`, `entry ${index + 1}`].join('\n')
      })

      writeFileSync(sourcePath, ['# Pika Session Log', '', ...entries].join('\n\n'))

      execFileSync('node', [scriptPath, '--source', sourcePath, '--output', outputPath], { cwd: repoRoot })

      const output = readFileSync(outputPath, 'utf8')

      expect(output.match(/^## /gm)).toHaveLength(40)
      expect(output).not.toContain('Entry 21')
      expect(output).toContain('Entry 22')
      expect(output).toContain('Entry 61')
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

    expect(script).toContain('const DEFAULT_MAX_ENTRIES = 60')
    expect(script).toContain('const DEFAULT_KEEP = Math.floor(DEFAULT_MAX_ENTRIES * 2 / 3)')
    expect(script).toContain('[--keep 40]')
    expect(script).toContain('[--max 60]')
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

      expect(output).toContain('source.md is within cap: 3/3 entries')
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })
})
