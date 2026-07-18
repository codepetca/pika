import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
      const archivePath = join(repoRoot, 'JOURNAL-ARCHIVE.md')

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
        [scriptPath, '--source', sourcePath, '--output', outputPath, '--archive', archivePath, '--keep', '2'],
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

      const archived = readFileSync(archivePath, 'utf8')

      expect(archived).toContain('## 2026-05-01 - First')
      expect(archived).toContain('first entry')
      expect(archived).not.toContain('## 2026-05-02 - Second')
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('orders entries chronologically before retaining the latest entries', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'pika-session-log-order-'))

    try {
      const sourcePath = join(repoRoot, 'source.md')
      const outputPath = join(repoRoot, 'SESSION-LOG.md')
      const archivePath = join(repoRoot, 'JOURNAL-ARCHIVE.md')

      writeFileSync(
        sourcePath,
        [
          '# Pika Session Log',
          '',
          '## 2026-05-03 - Third',
          'third entry',
          '',
          '## 2026-05-01 - First',
          'first entry',
          '',
          '## 2026-05-02 - Second A',
          'second entry A',
          '',
          '## 2026-05-02 - Second B',
          'second entry B',
          '',
        ].join('\n'),
      )

      execFileSync(
        'node',
        [scriptPath, '--source', sourcePath, '--output', outputPath, '--archive', archivePath, '--keep', '3'],
        { cwd: repoRoot },
      )

      const output = readFileSync(outputPath, 'utf8')
      const archived = readFileSync(archivePath, 'utf8')

      expect(output).not.toContain('## 2026-05-01 - First')
      expect(output.indexOf('## 2026-05-02 - Second A')).toBeLessThan(
        output.indexOf('## 2026-05-02 - Second B'),
      )
      expect(output.indexOf('## 2026-05-02 - Second B')).toBeLessThan(
        output.indexOf('## 2026-05-03 - Third'),
      )
      expect(archived).toContain('## 2026-05-01 - First')
      expect(archived).not.toContain('## 2026-05-03 - Third')
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
        const date = new Date(Date.UTC(2026, 4, index + 1)).toISOString().slice(0, 10)
        return [`## ${date} - Entry ${index + 1}`, `entry ${index + 1}`].join('\n')
      })

      writeFileSync(sourcePath, ['# Pika Session Log', '', ...entries].join('\n\n'))

      execFileSync('node', [scriptPath, '--source', sourcePath, '--output', outputPath, '--no-archive'], {
        cwd: repoRoot,
      })

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

      const archived = readFileSync(join(repoRoot, '.ai/JOURNAL-ARCHIVE.md'), 'utf8')

      expect(archived).toContain('## 2026-05-01 - First')
      expect(archived).toContain('first entry')
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
      rmSync(otherCwd, { recursive: true, force: true })
    }
  })

  it('appends trimmed entries to an existing archive without altering prior content', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'pika-session-log-archive-'))

    try {
      const sourcePath = join(repoRoot, 'source.md')
      const outputPath = join(repoRoot, 'SESSION-LOG.md')
      const archivePath = join(repoRoot, 'JOURNAL-ARCHIVE.md')
      const existingArchive = [
        '# Pika Project Journal',
        '',
        '## 2026-04-30 - Archived earlier',
        'older archived entry',
        '',
      ].join('\n')

      writeFileSync(archivePath, existingArchive)
      writeFileSync(
        sourcePath,
        [
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
        ].join('\n'),
      )

      execFileSync(
        'node',
        [scriptPath, '--source', sourcePath, '--output', outputPath, '--archive', archivePath, '--keep', '1'],
        { cwd: repoRoot },
      )

      const archived = readFileSync(archivePath, 'utf8')

      expect(archived).toContain('# Pika Project Journal')
      expect(archived).toContain('## 2026-04-30 - Archived earlier')
      expect(archived.indexOf('## 2026-04-30 - Archived earlier')).toBeLessThan(
        archived.indexOf('## 2026-05-01 - First'),
      )
      expect(archived.indexOf('## 2026-05-01 - First')).toBeLessThan(archived.indexOf('## 2026-05-02 - Second'))
      expect(archived).toContain('second entry')
      expect(archived).not.toContain('## 2026-05-03 - Third')
      expect(archived.endsWith('second entry\n')).toBe(true)
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('does not touch the archive when nothing is trimmed', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'pika-session-log-noop-'))

    try {
      const sourcePath = join(repoRoot, 'source.md')
      const outputPath = join(repoRoot, 'SESSION-LOG.md')
      const archivePath = join(repoRoot, 'JOURNAL-ARCHIVE.md')

      writeFileSync(
        sourcePath,
        ['# Pika Session Log', '', '## 2026-05-01 - First', 'first entry', ''].join('\n'),
      )

      execFileSync(
        'node',
        [scriptPath, '--source', sourcePath, '--output', outputPath, '--archive', archivePath, '--keep', '5'],
        { cwd: repoRoot },
      )

      expect(readFileSync(outputPath, 'utf8')).toContain('## 2026-05-01 - First')
      expect(existsSync(archivePath)).toBe(false)
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('does not duplicate archived entries when the output write is retried', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'pika-session-log-output-retry-'))

    try {
      const sourcePath = join(repoRoot, 'source.md')
      const outputPath = join(repoRoot, 'missing', 'SESSION-LOG.md')
      const archivePath = join(repoRoot, 'JOURNAL-ARCHIVE.md')
      const source = [
        '# Pika Session Log',
        '',
        '## 2026-05-01 - First',
        'first entry',
        '',
        '## 2026-05-02 - Second',
        'second entry',
        '',
      ].join('\n')

      writeFileSync(sourcePath, source)

      const failedRun = spawnSync(
        'node',
        [scriptPath, '--source', sourcePath, '--output', outputPath, '--archive', archivePath, '--keep', '1'],
        { cwd: repoRoot, encoding: 'utf8' },
      )

      expect(failedRun.status).toBe(1)
      expect(readFileSync(sourcePath, 'utf8')).toBe(source)
      expect(readFileSync(archivePath, 'utf8').match(/^## 2026-05-01 - First$/gm)).toHaveLength(1)

      mkdirSync(dirname(outputPath), { recursive: true })
      execFileSync(
        'node',
        [scriptPath, '--source', sourcePath, '--output', outputPath, '--archive', archivePath, '--keep', '1'],
        { cwd: repoRoot },
      )

      expect(readFileSync(outputPath, 'utf8')).toContain('## 2026-05-02 - Second')
      expect(readFileSync(archivePath, 'utf8').match(/^## 2026-05-01 - First$/gm)).toHaveLength(1)
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('defaults to a weekly evidence-sized retention window', () => {
    const script = readFileSync(scriptPath, 'utf8')

    expect(script).toContain('const DEFAULT_MAX_ENTRIES = 60')
    expect(script).toContain('const DEFAULT_KEEP = Math.floor(DEFAULT_MAX_ENTRIES * 2 / 3)')
    expect(script).toContain('[--keep 40]')
    expect(script).toContain('--check [--keep 60]')
    expect(script).not.toContain('--max')
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

  it('rejects a session log whose dated entries are out of order', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'pika-session-log-order-check-'))

    try {
      const sourcePath = join(repoRoot, 'source.md')
      const original = [
        '# Pika Session Log',
        '',
        '## 2026-05-02 - Second',
        'second entry',
        '',
        '## 2026-05-01 - First',
        'first entry',
        '',
      ].join('\n')

      writeFileSync(sourcePath, original)

      const result = spawnSync('node', [scriptPath, '--check', '--source', sourcePath], {
        cwd: repoRoot,
        encoding: 'utf8',
      })

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('dated entries are not in chronological order')
      expect(result.stderr).toContain('run node scripts/trim-session-log.mjs')
      expect(readFileSync(sourcePath, 'utf8')).toBe(original)
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('rejects removed --max arguments', () => {
    const result = spawnSync('node', [scriptPath, '--check', '--max', '20'], {
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Unknown or incomplete argument: --max')
    expect(result.stderr).toContain('--check [--keep 60]')
    expect(result.stderr).not.toContain('--max 60')
  })
})
