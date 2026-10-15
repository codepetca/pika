/** Coordinator-only startup evidence. No import-time I/O or native dispatch.
 * Each entered/completed/failed record is flushed before execution proceeds;
 * abrupt termination leaves the last entered stage, not a fabricated failure.
 */
import assert from 'node:assert/strict'
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, realpathSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'
import { types } from 'node:util'

const stages = ['launcher-binding', 'approval', 'output-allocation', 'module-imports', 'source-capture', 'dependency-capture', 'preparation-write',
  'runtime-input', 'source-files', 'pin-node', 'pin-ps', 'pin-python', 'pin-lsof', 'pin-sandbox', 'pin-codesign', 'pin-chrome', 'pin-helper',
  'runtime-dependencies', 'runtime-profile', 'runtime-admission', 'runtime-execution'] as const
export type BrowserStartupStage = typeof stages[number]
const codes = ['ERR_ASSERTION', 'ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_UNKNOWN_FILE_EXTENSION', 'ERR_REQUIRE_ESM',
  'EACCES', 'EPERM', 'ENOENT', 'EEXIST', 'ENOMEM', 'EMFILE', 'ENFILE', 'ENOSPC', 'ETIMEDOUT'] as const
function safeCode(error: unknown): typeof codes[number] | null {
  if (!error || typeof error !== 'object' || types.isProxy(error)) return null
  const code = Object.getOwnPropertyDescriptor(error, 'code')?.value
  return codes.find(value => value === code) ?? null
}

export function createBrowserStartupJournal(path: string) {
  const parent = dirname(path), directory = lstatSync(parent)
  assert(realpathSync(parent) === parent && directory.isDirectory() && !directory.isSymbolicLink()
    && directory.uid === process.getuid?.() && (directory.mode & 0o777) === 0o700)
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  const startedAt = Date.now()
  let sequence = 0, closed = false, failed = false
  const append = (stage: BrowserStartupStage, phase: 'entered' | 'completed' | 'failed', error?: unknown) => {
    assert(!closed && sequence < 96)
    const info = fstatSync(fd), named = lstatSync(path)
    assert(info.isFile() && !named.isSymbolicLink() && realpathSync(path) === path && info.nlink === 1 && named.nlink === 1
      && info.uid === process.getuid?.() && (info.mode & 0o777) === 0o600 && info.dev === named.dev && info.ino === named.ino)
    const bytes = Buffer.from(JSON.stringify({ version: 1, sequence: ++sequence, stage, phase,
      elapsedMs: Math.min(600000, Math.max(0, Date.now() - startedAt)), code: safeCode(error) }) + '\n')
    for (let offset = 0; offset < bytes.length;) { const written = writeSync(fd, bytes, offset, bytes.length - offset); assert(written > 0); offset += written }
    fsyncSync(fd)
  }
  return {
    async step<T>(stage: BrowserStartupStage, work: () => T | Promise<T>): Promise<T> {
      assert(!closed && !failed && stages.includes(stage))
      try {
        append(stage, 'entered')
        const result = await work()
        append(stage, 'completed')
        return result
      } catch (error) {
        failed = true
        // Failure to retain evidence also rejects; it never permits more work.
        append(stage, 'failed', error)
        throw error
      }
    },
    close() { if (!closed) { closed = true; closeSync(fd) } },
  }
}
export type BrowserStartupJournal = ReturnType<typeof createBrowserStartupJournal>
