/** Fixed private diagnostic data only. Importing this file performs no I/O. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { types } from 'node:util'

export const DIAGNOSTIC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
export const DIAGNOSTIC_VERSION = '155.0.8059.79'
export const DIAGNOSTIC_CHROME_SHA = 'fbeec33e75ea8da7bdb6e48f987ed32f5089c49d86013046e87319f5df11c13f'
export const diagnosticHash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
export const diagnosticSourceFiles = Object.freeze([
  'scripts/contextual-browser-diagnostic-data.ts', 'scripts/contextual-browser-diagnostic.ts',
  'scripts/contextual-browser-startup.ts',
  'e2e/helpers/contextual-browser-diagnostic-reporter.ts', 'e2e/contextual-browser-diagnostic.spec.ts',
  'e2e/helpers/contextual-browser-diagnostic-setup.ts',
  'e2e/helpers/contextual-browser-login-diagnostic.ts',
  'playwright.contextual-browser-diagnostic.config.ts', 'scripts/contextual-test-rehearsal-native.ts',
  'scripts/contextual-test-route-readiness.ts',
  'scripts/contextual-test-rehearsal-launch.ts', 'scripts/contextual-test-process-ownership.ts',
  'scripts/contextual-test-process-identity.py', 'scripts/contextual-assignment-list-proof-path.ts',
  'e2e/helpers/contextual-test-rehearsal.ts', 'package.json', 'pnpm-lock.yaml',
])
export type DiagnosticAdmission = { version: 1; nonce: string; outputDir: string; startedAt: number; deadline: number; cleanupDeadline: number; mode?: 'login-body' }
export function diagnosticDirectory(path: string) {
  assert.equal(realpathSync(path), path)
  const info = lstatSync(path); assert(info.isDirectory() && !info.isSymbolicLink() && (info.mode & 0o777) === 0o700 && info.uid === process.getuid?.())
}
export function assertDiagnosticPrivateUmask(actual: number) { assert.equal(actual, 0o077, 'Private diagnostic umask rejected') }
export function assertDiagnosticRunnerOutputModes(outputDir: string) {
  diagnosticDirectory(outputDir)
  let entries = 0
  const inspect = (path: string, depth: number): void => {
    assert(depth <= 8 && ++entries <= 64)
    const info = lstatSync(path)
    assert(!info.isSymbolicLink() && realpathSync(path) === path && info.uid === process.getuid?.())
    if (info.isDirectory()) {
      diagnosticDirectory(path)
      for (const name of readdirSync(path)) inspect(join(path, name), depth + 1)
    } else assert(info.isFile() && info.nlink === 1 && (info.mode & 0o777) === 0o600)
  }
  inspect(join(outputDir, 'runner-output'), 0)
}
export function diagnosticRead(path: string, maxBytes = 65536) {
  diagnosticDirectory(dirname(path))
  assert(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 65536)
  assert.equal(realpathSync(path), path)
  const before = lstatSync(path), fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = fstatSync(fd)
    assert(info.isFile() && !before.isSymbolicLink() && (info.mode & 0o777) === 0o600 && info.uid === process.getuid?.() && info.nlink === 1 && info.size > 0 && info.size <= maxBytes)
    assert(before.dev === info.dev && before.ino === info.ino)
    const bytes = readFileSync(fd, 'utf8'), after = fstatSync(fd), named = lstatSync(path)
    for (const actual of [after, named]) assert(actual.dev === info.dev && actual.ino === info.ino && actual.size === info.size && actual.mtimeMs === info.mtimeMs && actual.ctimeMs === info.ctimeMs && actual.mode === info.mode && actual.nlink === 1)
    assert.equal(realpathSync(path), path); diagnosticDirectory(dirname(path))
    return bytes
  } finally { closeSync(fd) }
}
export function diagnosticWrite(outputDir: string, name: 'admission.json' | 'spent.json' | 'owned-ready.json' | 'report.json' | 'lifecycle.json' | 'controller.json', value: unknown) {
  diagnosticDirectory(outputDir)
  writeFileSync(join(outputDir, name), JSON.stringify(value), { mode: 0o600, flag: 'wx' })
}
export function validateDiagnosticAdmission(raw: unknown, now: number): DiagnosticAdmission {
  assert(raw && typeof raw === 'object' && !Array.isArray(raw))
  const v = raw as DiagnosticAdmission
  assert.deepEqual(Object.keys(v).sort(), ['cleanupDeadline','deadline','nonce','outputDir','startedAt','version', ...(Object.hasOwn(v, 'mode') ? ['mode'] : [])].sort())
  assert(v.mode === undefined || v.mode === 'login-body')
  assert(v.version === 1 && /^[a-f0-9]{32}$/.test(v.nonce) && typeof v.outputDir === 'string')
  assert([now,v.startedAt,v.deadline,v.cleanupDeadline].every(Number.isSafeInteger))
  assert(v.startedAt <= now && now < v.deadline && v.deadline === v.startedAt + 90000 && v.cleanupDeadline === v.deadline + 360000)
  return v
}
export function diagnosticAdmissionFromEnvironment() {
  const file = process.env.PIKA_BROWSER_DIAGNOSTIC_FILE, digest = process.env.PIKA_BROWSER_DIAGNOSTIC_SHA256
  assert(file && digest && /^[a-f0-9]{64}$/.test(digest))
  const bytes = diagnosticRead(file); assert.equal(diagnosticHash(bytes), digest)
  const admission = validateDiagnosticAdmission(JSON.parse(bytes), Date.now())
  assert.equal(file, join(admission.outputDir, 'admission.json'))
  assert.equal(JSON.parse(diagnosticRead(join(admission.outputDir, 'spent.json'))).nonce, admission.nonce)
  return admission
}

const moduleCodes = ['ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND','ERR_REQUIRE_ESM','ERR_UNKNOWN_FILE_EXTENSION','ERR_UNSUPPORTED_DIR_IMPORT'] as const
const codes = ['EACCES','EPERM','ENOENT','ENOMEM','EMFILE','ENFILE','ETIMEDOUT', ...moduleCodes, 'ERR_ASSERTION'] as const
const signals = ['SIGABRT','SIGBUS','SIGILL','SIGKILL','SIGSEGV','SIGTERM','SIGTRAP'] as const
const categories = ['unknown','timeout','browser-launch','browser-closed','worker-exit','permission','missing-executable','missing-library','module-loading','assertion','type-error','reference-error','syntax-error','non-error-thrown','binding-rejected','startup-reporting-failed'] as const
const sources = ['unknown','fixture','config','spec'] as const
export type DiagnosticError = { category: typeof categories[number]; code: typeof codes[number] | null; signal: typeof signals[number] | null; source: typeof sources[number] }
// Read data properties only; never stringify an error, invoke getters, retain
// arbitrary names/locations, or copy message/stack/cause/stdout/stderr to disk.
function field(value: unknown, key: string): unknown {
  try { if (value && typeof value === 'object' && !types.isProxy(value)) return Object.getOwnPropertyDescriptor(value, key)?.value } catch { /* fixed fallback */ }
  return undefined
}
export function classifyDiagnosticError(error: unknown): DiagnosticError {
  // Playwright 1.58 serializes Error as { message, stack, cause } and other
  // thrown values as { value }. Inspect only the first cause; never read stack.
  const parts: { text: string; message: string; fromValue: boolean; code: unknown; signal: unknown; name: unknown; location: unknown }[] = []
  const seen = new Set<unknown>()
  let current = error
  for (let depth = 0; depth < 2 && current && typeof current === 'object' && !seen.has(current); depth++) {
    seen.add(current)
    const rawMessage = field(current, 'message'), rawValue = field(current, 'value')
    const message = typeof rawMessage === 'string' && rawMessage.length <= 65536 ? rawMessage : ''
    const value = typeof rawValue === 'string' && rawValue.length <= 65536 ? rawValue : ''
    parts.push({ text: message || value, message, fromValue: !message && !!value, code: field(current, 'code'), signal: field(current, 'signal'), name: field(current, 'name'), location: field(current, 'location') })
    current = field(current, 'cause')
  }
  const contains = (phrase: string) => parts.some(part => part.text.includes(phrase))
  const starts = (prefix: string) => parts.some(part => part.text.startsWith(prefix))
  const exactError = (message: string) => parts.some(part => [message, `Error: ${message}`, `'${message}'`, `'Error: ${message}'`].includes(part.text))
  const code = codes.find(v => parts.some(part => part.code === v || new RegExp(`\\b${v}\\b`).test(part.text))) ?? null
  const signal = signals.find(v => parts.some(part => part.signal === v || new RegExp(`\\b${v}\\b`).test(part.text))) ?? null
  const category = code === 'EACCES' || code === 'EPERM' ? 'permission'
    : code === 'ENOENT' || contains("Executable doesn't exist") || contains("because executable doesn't exist at") ? 'missing-executable'
    : code !== null && moduleCodes.some(value => value === code) ? 'module-loading'
    : code === 'ERR_ASSERTION' ? 'assertion'
    : contains('Library not loaded:') || contains('error while loading shared libraries:') ? 'missing-library'
    : parts.some(part => part.name === 'TimeoutError') || parts.some(part => /(?:Test timeout of|Timeout \d+ms exceeded)/.test(part.text)) ? 'timeout'
    : contains('Target page, context or browser has been closed') || contains('Browser closed') ? 'browser-closed'
    : contains('browserType.launch') || contains('Failed to launch the browser process.') ? 'browser-launch'
    : starts('Error: worker process exited unexpectedly (code=') ? 'worker-exit'
    : exactError('Private contextual Test binding rejected') ? 'binding-rejected'
    : exactError('Private contextual Test startup reporting failed') ? 'startup-reporting-failed'
    : parts.some(part => part.name === 'TypeError' || part.message.startsWith('TypeError: ')) ? 'type-error'
    : parts.some(part => part.name === 'ReferenceError' || part.message.startsWith('ReferenceError: ')) ? 'reference-error'
    : parts.some(part => part.name === 'SyntaxError' || part.message.startsWith('SyntaxError: ')) ? 'syntax-error'
    : parts.some(part => part.fromValue) ? 'non-error-thrown' : 'unknown'
  const files = parts.map(part => field(part.location, 'file'))
  const source = files.some(file => typeof file === 'string' && (file.endsWith('/e2e/contextual-browser-diagnostic.spec.ts') || file.endsWith('/e2e/contextual-test-lifecycle.spec.ts'))) ? 'spec'
    : files.some(file => typeof file === 'string' && (file.endsWith('/playwright.contextual-browser-diagnostic.config.ts') || file.endsWith('/playwright.contextual-tests.config.ts'))) ? 'config'
    : contains('browserType.launch') || contains('Failed to launch the browser process.') || contains("Failed to launch chromium because executable doesn't exist at") ? 'fixture' : 'unknown'
  return { category, code, signal, source }
}
export type DiagnosticReport = { version: 1; status: 'passed' | 'failed' | 'timedout' | 'interrupted'; discovered: number; started: number; ended: number; passed: number; errors: DiagnosticError[]; overflow: boolean }
export function validateDiagnosticReport(raw: unknown): DiagnosticReport {
  assert(raw && typeof raw === 'object' && !Array.isArray(raw)); const v = raw as DiagnosticReport
  assert.deepEqual(Object.keys(v).sort(), ['discovered','ended','errors','overflow','passed','started','status','version'])
  assert(v.version === 1 && ['passed','failed','timedout','interrupted'].includes(v.status) && typeof v.overflow === 'boolean')
  for (const key of ['discovered','started','ended','passed'] as const) assert(Number.isSafeInteger(v[key]) && v[key] >= 0 && v[key] <= 2)
  assert(Array.isArray(v.errors) && v.errors.length <= 8)
  for (const e of v.errors) {
    assert.deepEqual(Object.keys(e).sort(), ['category','code','signal','source'])
    assert(categories.includes(e.category) && sources.includes(e.source) && (e.code === null || codes.includes(e.code)) && (e.signal === null || signals.includes(e.signal)))
  }
  return v
}
export function diagnosticReportPassed(raw: unknown) {
  const v = validateDiagnosticReport(raw)
  return v.status === 'passed' && v.discovered === 1 && v.started === 1 && v.ended === 1 && v.passed === 1 && !v.overflow && v.errors.length === 0
}
