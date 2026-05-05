import { execFileSync } from 'node:child_process'
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
})
