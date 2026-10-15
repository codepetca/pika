import { describe, expect, it } from 'vitest'
import { chmodSync, linkSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBrowserStartupJournal } from '../../scripts/contextual-browser-startup'
import { runContextualBrowserDiagnostic } from '../../scripts/contextual-browser-diagnostic'

function fixture() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'pika-startup-cpu-')))
  chmodSync(directory, 0o700)
  const path = join(directory, 'startup.jsonl')
  return { directory, path, rows: () => readFileSync(path, 'utf8').trim().split('\n').map(row => JSON.parse(row)),
    cleanup: () => rmSync(directory, { recursive: true }) }
}
describe('durable browser startup journal; CPU only', () => {
  it('retains a runtime rejection before admission or native setup', async () => {
    const f = fixture(), journal = createBrowserStartupJournal(f.path), mask = process.umask(0o077)
    try {
      await expect(runContextualBrowserDiagnostic({ mode: 'invalid' } as never, journal)).rejects.toThrow()
      expect(f.rows()).toMatchObject([{ stage: 'runtime-input', phase: 'entered' }, { stage: 'runtime-input', phase: 'failed', code: 'ERR_ASSERTION' }])
    } finally { process.umask(mask); journal.close(); f.cleanup() }
  })
  it('persists entered before work settles, then completed, without needing close or stdout', async () => {
    const f = fixture(), journal = createBrowserStartupJournal(f.path)
    try {
      let release!: () => void
      const work = journal.step('runtime-dependencies', () => new Promise<void>(resolve => { release = resolve }))
      expect(f.rows()).toMatchObject([{ sequence: 1, stage: 'runtime-dependencies', phase: 'entered', code: null }])
      release(); await work
      expect(f.rows()).toMatchObject([{ phase: 'entered' }, { sequence: 2, stage: 'runtime-dependencies', phase: 'completed' }])
    } finally { journal.close(); f.cleanup() }
  })
  it('records the exact failed stage and safe code, preserves the actual error and prevents continued execution', async () => {
    const f = fixture(), journal = createBrowserStartupJournal(f.path)
    try {
      const error = Object.assign(new Error('SECRET /private/path https://secret.invalid'), { code: 'ERR_ASSERTION', stdout: 'SECRET' })
      await expect(journal.step('runtime-dependencies', () => { throw error })).rejects.toBe(error)
      expect(f.rows().at(-1)).toMatchObject({ stage: 'runtime-dependencies', phase: 'failed', code: 'ERR_ASSERTION' })
      expect(readFileSync(f.path, 'utf8')).not.toMatch(/SECRET|private\/path|secret.invalid|stack|message|stdout/)
      let ran = false
      await expect(journal.step('runtime-execution', () => { ran = true })).rejects.toThrow()
      expect(ran).toBe(false)
    } finally { journal.close(); f.cleanup() }
  })
  it('never invokes error getters or proxy traps and never stores arbitrary codes', async () => {
    for (const variant of ['accessor', 'proxy', 'unknown']) {
      const f = fixture(), journal = createBrowserStartupJournal(f.path); let reads = 0
      try {
        const error = variant === 'accessor' ? Object.defineProperty({}, 'code', { get() { reads++; throw Error('SECRET') } })
          : variant === 'proxy' ? new Proxy({}, { getOwnPropertyDescriptor() { reads++; throw Error('SECRET') } }) : { code: 'SECRET' }
        await expect(journal.step('module-imports', () => Promise.reject(error))).rejects.toBe(error)
        expect(reads).toBe(0); expect(f.rows().at(-1).code).toBe(null)
      } finally { journal.close(); f.cleanup() }
    }
  })
  it('rejects existing files, symlinks and public parent directories without overwrite', () => {
    const f = fixture()
    try {
      writeFileSync(f.path, 'retained', { mode: 0o600 })
      expect(() => createBrowserStartupJournal(f.path)).toThrow(); expect(readFileSync(f.path, 'utf8')).toBe('retained')
      const link = join(f.directory, 'linked'); symlinkSync(f.path, link)
      expect(() => createBrowserStartupJournal(link)).toThrow()
      chmodSync(f.directory, 0o755)
      expect(() => createBrowserStartupJournal(join(f.directory, 'other'))).toThrow()
    } finally { f.cleanup() }
  })
  it('fails closed on a changed journal inode or link count before executing another stage', async () => {
    const f = fixture(), journal = createBrowserStartupJournal(f.path)
    try {
      await journal.step('module-imports', () => {})
      linkSync(f.path, join(f.directory, 'linked'))
      let ran = false
      await expect(journal.step('runtime-execution', () => { ran = true })).rejects.toThrow()
      expect(ran).toBe(false)
    } finally { journal.close(); f.cleanup() }
  })
  it('rejects unknown labels and use after close, without running work', async () => {
    const f = fixture(), journal = createBrowserStartupJournal(f.path)
    try {
      let ran = false
      await expect(journal.step('SECRET' as never, () => { ran = true })).rejects.toThrow()
      journal.close()
      await expect(journal.step('module-imports', () => { ran = true })).rejects.toThrow()
      expect(ran).toBe(false)
    } finally { journal.close(); f.cleanup() }
  })
  it('bounds retained records and will not dispatch work after the cap', async () => {
    const f = fixture(), journal = createBrowserStartupJournal(f.path)
    try {
      for (let i = 0; i < 48; i++) await journal.step('module-imports', () => {})
      let ran = false
      await expect(journal.step('runtime-execution', () => { ran = true })).rejects.toThrow()
      expect(ran).toBe(false); expect(f.rows()).toHaveLength(96)
    } finally { journal.close(); f.cleanup() }
  })
})
